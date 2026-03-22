// MIT LICENSE
//
// COPYRIGHT (R) 2025 ARNELIFY. AUTHOR: TARON SARKISYAN
//
// PERMISSION IS HEREBY GRANTED, FREE OF CHARGE, TO ANY PERSON OBTAINING A COPY
// OF THIS SOFTWARE AND ASSOCIATED DOCUMENTATION FILES (THE "SOFTWARE"), TO DEAL
// IN THE SOFTWARE WITHOUT RESTRICTION, INCLUDING WITHOUT LIMITATION THE RIGHTS
// TO USE, COPY, MODIFY, MERGE, PUBLISH, DISTRIBUTE, SUBLICENSE, AND/OR SELL
// COPIES OF THE SOFTWARE, AND TO PERMIT PERSONS TO WHOM THE SOFTWARE IS
// FURNISHED TO DO SO, SUBJECT TO THE FOLLOWING CONDITIONS:
//
// THE ABOVE COPYRIGHT NOTICE AND THIS PERMISSION NOTICE SHALL BE INCLUDED IN ALL
// COPIES OR SUBSTANTIAL PORTIONS OF THE SOFTWARE.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use std::{
  collections::HashMap,
  io::{Error, ErrorKind},
  net::{SocketAddr, ToSocketAddrs},
  process, str,
  sync::{Arc, Mutex},
  time::{SystemTime, UNIX_EPOCH},
};

use tokio::{
  net::UdpSocket,
  runtime::{Builder, Runtime},
  sync::{Mutex as AsyncMutex, Notify},
  time,
  time::{Duration, Interval},
};

type UMQTCtx = serde_json::Value;

pub type UMQTBytes = Vec<u8>;
pub type JSON = serde_json::Value;

pub fn generate_request_id() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("Time went backwards")
    .as_nanos()
}

#[derive(Clone, Default)]
pub struct UMQTOpts {
  pub block_size_kb: usize,
  pub cert_pem: String,
  pub compression: bool,
  pub key_pem: String,
  pub port: u16,
  pub thread_limit: u64,
}

struct UMQTReq {
  _opts: UMQTOpts,

  has_body: bool,
  has_meta: bool,

  prefix: String,
  reliable: bool,
  topic: String,
  request_id: String,
  buff: Vec<u8>,
  binary: Vec<u8>,

  compression: Option<String>,
  binary_length: usize,
  json_length: usize,

  ctx: UMQTCtx,
}

impl UMQTReq {
  pub fn new(_opts: UMQTOpts) -> Self {
    Self {
      _opts,

      has_body: false,
      has_meta: false,

      prefix: String::new(),
      reliable: false,
      topic: String::new(),
      request_id: String::new(),
      buff: Vec::new(),
      binary: Vec::new(),

      compression: None,
      binary_length: 0,
      json_length: 0,

      ctx: serde_json::json!({
        "id": JSON::Null,
        "prefix": JSON::Null,
        "reliable": false,
        "topic": JSON::Null,
      }),
    }
  }

  pub fn add(&mut self, block: &[u8]) -> () {
    self.buff.extend_from_slice(block);
  }

  pub fn get_bytes(&self) -> Vec<u8> {
    self.binary.to_vec()
  }

  // pub fn get_compression(&self) -> Option<String> {
  //   self.compression.clone()
  // }

  pub fn get_prefix(&self) -> String {
    self.prefix.clone()
  }

  pub fn get_reliable(&self) -> bool {
    self.reliable.clone()
  }

  pub fn get_request_id(&self) -> String {
    self.request_id.clone()
  }

  pub fn get_topic(&self) -> String {
    self.topic.clone()
  }

  fn read_meta(&mut self, meta_end: usize) -> Result<u8, Error> {
    let meta_bytes: &[u8] = &self.buff[..meta_end];
    let pos = match meta_bytes.iter().position(|&b| b == b'+') {
      Some(v) => v,
      None => return Err(Error::new(ErrorKind::InvalidData, "Missing '+' in meta")),
    };

    let json_length: &str = match std::str::from_utf8(&meta_bytes[..pos]) {
      Ok(s) => s,
      Err(_) => {
        return Err(Error::new(ErrorKind::InvalidData, "Invalid UTF-8."));
      }
    };

    self.json_length = match json_length.parse() {
      Ok(n) => n,
      Err(_) => return Err(Error::new(ErrorKind::InvalidData, "Invalid meta.")),
    };

    let binary_length: &str = match std::str::from_utf8(&meta_bytes[pos + 1..]) {
      Ok(s) => s,
      Err(_) => {
        return Err(Error::new(ErrorKind::InvalidData, "Invalid UTF-8."));
      }
    };

    self.binary_length = match binary_length.parse() {
      Ok(n) => n,
      Err(_) => return Err(Error::new(ErrorKind::InvalidData, "Invalid meta.")),
    };

    Ok(1)
  }

  fn read_body(&mut self) -> Result<Option<u8>, Error> {
    if !self.has_meta {
      let meta_end: usize = match self.buff.iter().position(|&b| b == b':') {
        Some(pos) => pos,
        None => {
          if self.buff.len() > 8192 {
            self.buff.clear();
            return Err(Error::new(
              ErrorKind::InvalidData,
              "The maximum size of the meta has been exceeded.",
            ));
          }

          return Ok(None);
        }
      };

      match self.read_meta(meta_end) {
        Ok(_) => {}
        Err(e) => {
          self.buff.clear();
          return Err(e);
        }
      }

      self.has_meta = true;
      self.buff.drain(..=meta_end);
    }

    if self.json_length != 0 && self.buff.len() >= self.json_length {
      let json: &str = match std::str::from_utf8(&self.buff[..self.json_length]) {
        Ok(v) => v,
        Err(_) => {
          self.buff.clear();
          return Err(Error::new(ErrorKind::InvalidInput, "Invalid UTF-8."));
        }
      };

      let ctx: UMQTCtx = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => {
          self.buff.clear();
          return Err(Error::new(ErrorKind::InvalidInput, "Invalid JSON."));
        }
      };

      if ctx.get("id").is_none()
        || ctx.get("prefix").is_none()
        || ctx.get("reliable").is_none()
        || ctx.get("topic").is_none()
      {
        return Err(Error::new(ErrorKind::InvalidInput, "Invalid message."));
      }

      self.prefix = String::from(ctx["prefix"].as_str().unwrap_or(""));
      self.reliable = ctx["reliable"].as_bool().unwrap_or(false);
      self.request_id = String::from(ctx["id"].as_str().unwrap_or(""));
      self.topic = String::from(ctx["topic"].as_str().unwrap_or(""));

      self.buff.drain(..self.json_length);
      if self.binary_length == 0 {
        self.has_body = true;
        return Ok(Some(1));
      }
    }

    if self.binary_length != 0 && self.buff.len() >= self.binary_length {
      self.binary = self.buff[..self.binary_length].to_vec();

      self.has_body = true;
      self.buff.drain(..self.binary_length);
      return Ok(Some(1));
    }

    Ok(None)
  }

  pub fn read_block(&mut self) -> Result<Option<u8>, Error> {
    if !self.has_body {
      match self.read_body() {
        Ok(Some(_)) => {}
        Ok(None) => return Ok(None),
        Err(e) => return Err(e),
      }
    }

    Ok(Some(1))
  }

  pub fn reset(&mut self) -> () {
    self.has_body = false;
    self.has_meta = false;

    self.prefix.clear();
    self.reliable = false;
    self.topic.clear();
    self.request_id.clear();
    self.binary.clear();

    self.compression = None;
    self.binary_length = 0;
    self.json_length = 0;
    self.ctx = serde_json::json!({
      "id": JSON::Null,
      "topic": JSON::Null,
      "prefix": JSON::Null
    });
  }
}

pub type UMQTConsumer = dyn Fn(Arc<Mutex<UMQTBytes>>) + Send + Sync;
pub type UMQTLogger = dyn Fn(&str, &str) + Send + Sync;

pub struct UMQT {
  opts: UMQTOpts,
  cb_logger: Arc<Mutex<Arc<UMQTLogger>>>,
  consumers: Arc<Mutex<HashMap<String, Arc<UMQTConsumer>>>>,
  jobs: Arc<Mutex<HashMap<u128, UMQTBytes>>>,
  notify_discovery: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
  notify_sent: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
  notify_finish: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
  topic_servers: Arc<Mutex<HashMap<String, Vec<SocketAddr>>>>,
  socket: Arc<Mutex<Option<Arc<UdpSocket>>>>,
  shutdown: Arc<Notify>,
  rt: Runtime,
}

impl UMQT {
  pub fn new(opts: UMQTOpts) -> Self {
    if opts.cert_pem.len() > 0 && opts.key_pem.len() > 0 {
      //TODO: TLS
    }

    let rt: Runtime = Builder::new_multi_thread()
      .worker_threads(opts.thread_limit as usize)
      .enable_all()
      .build()
      .unwrap();

    Self {
      opts,
      cb_logger: Arc::new(Mutex::new(Arc::new(move |_level: &str, message: &str| {
        println!("[Arnelify Broker]: {}", message);
      }))),
      consumers: Arc::new(Mutex::new(HashMap::new())),
      jobs: Arc::new(Mutex::new(HashMap::new())),
      notify_discovery: Arc::new(AsyncMutex::new(HashMap::new())),
      notify_sent: Arc::new(AsyncMutex::new(HashMap::new())),
      notify_finish: Arc::new(AsyncMutex::new(HashMap::new())),
      topic_servers: Arc::new(Mutex::new(HashMap::new())),
      socket: Arc::new(Mutex::new(None)),
      shutdown: Arc::new(Notify::new()),
      rt,
    }
  }

  async fn acceptor(
    &self,
    socket: Arc<UdpSocket>,
    _logger_rt: Arc<Mutex<Arc<UMQTLogger>>>,
    consumers_rt: Arc<Mutex<HashMap<String, Arc<UMQTConsumer>>>>,
    jobs_rt: Arc<Mutex<HashMap<u128, UMQTBytes>>>,
    notify_discovery_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
    notify_sent_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
    notify_finish_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>>,
    opts_rt: Arc<UMQTOpts>,
  ) -> () {
    let block_size: usize = opts_rt.block_size_kb * 1024;
    let mut buffer: Vec<u8> = vec![0u8; block_size];

    let (size, addr) = match socket.recv_from(&mut buffer).await {
      Ok(v) => v,
      Err(_) => return,
    };

    let mut req: UMQTReq = UMQTReq::new((*opts_rt).clone());
    req.add(&buffer[..size]);
    match req.read_block() {
      Ok(Some(_)) => {
        let prefix: String = req.get_prefix();
        let is_reliable: bool = req.get_reliable();
        let request_id: String = req.get_request_id();
        let topic: String = req.get_topic();
        let bytes: Arc<Mutex<UMQTBytes>> = Arc::new(Mutex::new(req.get_bytes()));
        req.reset();

        match prefix.as_str() {
          "i" => {
            let mut buff: Vec<u8> = Vec::new();
            let ctx: UMQTCtx = serde_json::json!({
              "id": request_id,
              "prefix": "v",
              "reliable": is_reliable,
              "topic": topic
            });

            let json: String = serde_json::to_string(&ctx).unwrap();
            let meta: String = format!("{}+0:", json.len());
            buff.extend_from_slice(meta.as_bytes());
            buff.extend_from_slice(json.as_bytes());

            let _ = socket.send_to(&buff, addr).await;
          }
          "v" => {
            let req_id: u128 = request_id.parse().unwrap_or(0);
            {
              let mut map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
                notify_discovery_rt.lock().await;
              if let Some(notify) = map.remove(&req_id) {
                notify.notify_one();
              } else {
                return;
              }
            }

            let job_ctx: UMQTCtx = serde_json::json!({
              "id": request_id,
              "prefix": "_",
              "reliable": is_reliable,
              "topic": topic
            });

            let job_bytes: UMQTBytes = {
              let mut jobs: std::sync::MutexGuard<'_, HashMap<u128, UMQTBytes>> =
                jobs_rt.lock().unwrap();
              if let Some(bytes) = jobs.remove(&req_id) {
                bytes.clone()
              } else {
                return;
              }
            };

            let mut buff: Vec<u8> = Vec::new();
            let job_json: String = serde_json::to_string(&job_ctx).unwrap();
            let meta: String = format!("{}+{}:", job_json.len(), job_bytes.len());
            buff.extend_from_slice(meta.as_bytes());
            buff.extend_from_slice(&job_json.as_bytes());
            buff.extend_from_slice(&job_bytes);

            if !is_reliable {
              let socket_safe: Arc<UdpSocket> = Arc::clone(&socket);
              tokio::spawn(async move {
                let _ = socket_safe.send_to(&buff, addr).await;
              });
              return;
            }

            let notify_sent: Arc<Notify> = {
              let map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
                notify_sent_rt.lock().await;
              if let Some(notify) = map.get(&req_id) {
                notify.clone()
              } else {
                return;
              }
            };

            let socket_safe: Arc<UdpSocket> = Arc::clone(&socket);
            tokio::spawn(async move {
              let mut interval: Interval = time::interval(Duration::from_millis(300));
              loop {
                tokio::select! {
                  _ = notify_sent.notified() => {
                    break;
                  }
                  _ = interval.tick() => {
                    let _ = socket_safe.send_to(&buff, addr).await;
                  }
                }
              }
            });
          }
          "x" => {
            let req_id: u128 = request_id.parse().unwrap_or(0);
            {
              let mut map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
                notify_finish_rt.lock().await;
              if let Some(notify) = map.remove(&req_id) {
                notify.notify_one();
              } else {
                return;
              }
            }

            let mut jobs_lock: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
              notify_sent_rt.lock().await;
            if let Some(notify) = jobs_lock.remove(&req_id) {
              notify.notify_one();
            }
          }
          _ => {
            if is_reliable {
              let mut buff: Vec<u8> = Vec::new();
              let ctx: UMQTCtx = serde_json::json!({
                "id": request_id,
                "prefix": "x",
                "reliable": is_reliable,
                "topic": topic
              });

              let json: String = serde_json::to_string(&ctx).unwrap();
              let meta: String = format!("{}+0:", json.len());
              buff.extend_from_slice(meta.as_bytes());
              buff.extend_from_slice(&json.as_bytes());

              let _ = socket.send_to(&buff, addr).await;
            }

            let handler_opt: Option<Arc<UMQTConsumer>> = {
              let consumers_lock: std::sync::MutexGuard<'_, HashMap<String, Arc<UMQTConsumer>>> =
                consumers_rt.lock().unwrap();
              consumers_lock.get(&topic).cloned()
            };

            if let Some(handler) = handler_opt {
              handler(bytes);
            }
          }
        }
      }
      Ok(None) => {}
      Err(_) => {}
    }
  }

  pub fn add_server(&self, topic: &str, host: &str, port: u16) {
    let addr: String = format!("{}:{}", host, port);

    let sock_addr: SocketAddr = match addr
      .to_socket_addrs()
      .ok()
      .and_then(|mut it: std::vec::IntoIter<SocketAddr>| it.next())
    {
      Some(a) => a,
      None => {
        let logger_lock = self.cb_logger.lock().unwrap();
        (logger_lock)("error", &format!("Invalid address: {}", addr));
        return;
      }
    };

    let mut map_lock: std::sync::MutexGuard<'_, HashMap<String, Vec<SocketAddr>>> =
      self.topic_servers.lock().unwrap();
    map_lock
      .entry(String::from(topic))
      .or_default()
      .push(sock_addr);
  }

  pub fn logger(&self, cb: Arc<UMQTLogger>) {
    let mut logger_lock: std::sync::MutexGuard<'_, Arc<UMQTLogger>> =
      self.cb_logger.lock().unwrap();
    *logger_lock = cb;
  }

  pub fn on(&self, topic: &str, cb: Arc<UMQTConsumer>) {
    let mut map: std::sync::MutexGuard<'_, HashMap<String, Arc<UMQTConsumer>>> =
      self.consumers.lock().unwrap();
    map.insert(String::from(topic), cb);
  }

  pub fn send(&self, topic: &str, bytes: &[u8], is_reliable: bool) -> () {
    self.rt.block_on(async move {
      let servers: Vec<SocketAddr> = {
        let map_lock: std::sync::MutexGuard<'_, HashMap<String, Vec<SocketAddr>>> =
          self.topic_servers.lock().unwrap();
        match map_lock.get(topic) {
          Some(v) => v.clone(),
          _ => {
            return;
          }
        }
      };

      let socket: Arc<UdpSocket> = {
        let socket_lock: std::sync::MutexGuard<'_, Option<Arc<UdpSocket>>> =
          self.socket.lock().unwrap();
        match socket_lock.as_ref() {
          Some(s) => Arc::clone(s),
          None => {
            let logger_lock: std::sync::MutexGuard<'_, Arc<UMQTLogger>> =
              self.cb_logger.lock().unwrap();
            (logger_lock)("error", "producer called before start()");
            process::exit(1);
          }
        }
      };

      let request_id: u128 = generate_request_id();
      {
        let mut map: std::sync::MutexGuard<'_, HashMap<u128, UMQTBytes>> =
          self.jobs.lock().unwrap();
        map.insert(request_id, bytes.to_vec());
      }

      let notify_discovery: Arc<Notify> = Arc::new(Notify::new());
      {
        let mut map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
          self.notify_discovery.lock().await;
        map.insert(request_id, Arc::clone(&notify_discovery));
      }

      let ctx: UMQTCtx = serde_json::json!({
          "id": request_id.to_string(),
          "prefix": "i",
          "reliable": is_reliable,
          "topic": topic,
      });

      if self.opts.compression {
        //TODO: Brotli
      }

      let mut buff: Vec<u8> = Vec::new();
      let json: String = serde_json::to_string(&ctx).unwrap();
      let meta: String = format!("{}+0:", json.len());

      buff.extend_from_slice(meta.as_bytes());
      buff.extend_from_slice(json.as_bytes());

      if !is_reliable {
        let mut interval: Interval = time::interval(Duration::from_millis(300));
        loop {
          tokio::select! {
            _ = notify_discovery.notified() => {
              break;
            }
            _ = interval.tick() => {
              for addr in &servers {
                let _ = socket.send_to(&buff, addr).await;
              }
            }
          }
        }

        return;
      }

      let notify_sent: Arc<Notify> = Arc::new(Notify::new());
      {
        let mut map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
          self.notify_sent.lock().await;
        map.insert(request_id, Arc::clone(&notify_sent));
      }

      let notify_finish: Arc<Notify> = Arc::new(Notify::new());
      {
        let mut map: tokio::sync::MutexGuard<'_, HashMap<u128, Arc<Notify>>> =
          self.notify_finish.lock().await;
        map.insert(request_id, Arc::clone(&notify_finish));
      }

      let mut interval: Interval = time::interval(Duration::from_millis(300));
      loop {
        tokio::select! {
          _ = notify_discovery.notified() => {
            break;
          }
          _ = interval.tick() => {
            for addr in &servers {
              let _ = socket.send_to(&buff, addr).await;
            }
          }
        }
      }

      notify_finish.notified().await;
    });
  }

  pub fn start(&self) -> () {
    let logger_rt: Arc<Mutex<Arc<UMQTLogger>>> = Arc::clone(&self.cb_logger);
    let consumers_rt: Arc<Mutex<HashMap<String, Arc<UMQTConsumer>>>> = Arc::clone(&self.consumers);
    let jobs_rt: Arc<Mutex<HashMap<u128, UMQTBytes>>> = Arc::clone(&self.jobs);
    let notify_discovery_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>> =
      Arc::clone(&self.notify_discovery);
    let notify_sent_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>> = Arc::clone(&self.notify_sent);
    let notify_finish_rt: Arc<AsyncMutex<HashMap<u128, Arc<Notify>>>> =
      Arc::clone(&self.notify_finish);
    let opts_rt: Arc<UMQTOpts> = Arc::new(self.opts.clone());
    let shutdown_rt: Arc<Notify> = Arc::clone(&self.shutdown);
    let socket_rt: Arc<Mutex<Option<Arc<UdpSocket>>>> = Arc::clone(&self.socket);

    self.rt.block_on(async move {
      let addr: (&str, u16) = ("0.0.0.0", opts_rt.port);
      let socket: UdpSocket = match UdpSocket::bind(&addr).await {
        Ok(s) => s,
        Err(_) => {
          let logger_lock = logger_rt.lock().unwrap();
          logger_lock("error", &format!("Port {} already in use.", opts_rt.port));
          return;
        }
      };

      let socket: Arc<UdpSocket> = Arc::new(socket);
      {
        let mut socket_lock: std::sync::MutexGuard<'_, Option<Arc<UdpSocket>>> =
          socket_rt.lock().unwrap();
        *socket_lock = Some(Arc::clone(&socket));
      }

      {
        let logger_lock: std::sync::MutexGuard<'_, Arc<UMQTLogger>> = logger_rt.lock().unwrap();
        logger_lock("success", &format!("UMQT on {}", opts_rt.port));
      }

      loop {
        tokio::select! {
          _ = shutdown_rt.notified() => {
            break;
          }
          _ = self.acceptor(
            Arc::clone(&socket),
            Arc::clone(&logger_rt),
            Arc::clone(&consumers_rt),
            Arc::clone(&jobs_rt),
            Arc::clone(&notify_discovery_rt),
            Arc::clone(&notify_sent_rt),
            Arc::clone(&notify_finish_rt),
            Arc::clone(&opts_rt),
          ) => {}
        }
      }

      let mut socket_lock: std::sync::MutexGuard<'_, Option<Arc<UdpSocket>>> =
        socket_rt.lock().unwrap();
      *socket_lock = None;
    });
  }

  pub fn stop(&self) -> () {
    self.shutdown.notify_waiters();
  }
}
