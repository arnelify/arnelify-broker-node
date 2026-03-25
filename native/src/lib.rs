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

use neon::{prelude::*, types::buffer::TypedArray};

pub mod ipc;
pub mod transport;

use ipc::{UnixDomainSocket, UnixDomainSocketBytes, UnixDomainSocketOpts};
pub use transport::{UMQT, UMQTBytes, UMQTConsumer, UMQTLogger, UMQTOpts};

use std::{
  collections::HashMap,
  convert::TryFrom,
  sync::{Arc, Mutex, MutexGuard, OnceLock, mpsc},
  thread,
};

type JSON = serde_json::Value;

static UMQT_MAP: OnceLock<Mutex<HashMap<u64, Arc<UMQT>>>> = OnceLock::new();
static UMQT_ID: OnceLock<Mutex<u64>> = OnceLock::new();
static UMQT_UDS_MAP: OnceLock<Mutex<HashMap<u64, Arc<UnixDomainSocket>>>> = OnceLock::new();

fn get_str(opts: &JSON, key: &str) -> String {
  opts
    .get(key)
    .and_then(JSON::as_str)
    .expect(&format!(
      "[Arnelify Server]: NEON error: '{}' missing or not a string.",
      key
    ))
    .to_string()
}

fn get_u64(opts: &JSON, key: &str) -> u64 {
  opts.get(key).and_then(JSON::as_u64).expect(&format!(
    "[Arnelify Server]: NEON error: '{}' missing or not a u64.",
    key
  ))
}

fn get_usize(opts: &JSON, key: &str) -> usize {
  let val: u64 = get_u64(opts, key);
  usize::try_from(val).expect(&format!(
    "[Arnelify Server]: NEON error: '{}' out of usize range.",
    key
  ))
}

fn get_u16(opts: &JSON, key: &str) -> u16 {
  let val: u64 = get_u64(opts, key);
  u16::try_from(val).expect(&format!(
    "[Arnelify Server]: NEON error: '{}' out of u16 range.",
    key
  ))
}

fn get_bool(opts: &JSON, key: &str) -> bool {
  opts.get(key).and_then(JSON::as_bool).expect(&format!(
    "[Arnelify Server]: NEON error: '{}' missing or not a bool.",
    key
  ))
}

fn umqt_add_server(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let topic: String = cx.argument::<JsString>(1)?.value(&mut cx);
  let host: String = cx.argument::<JsString>(2)?.value(&mut cx);
  let js_port: f64 = cx.argument::<JsNumber>(3)?.value(&mut cx);
  
  let id: u64 = js_id as u64;
  let port: u16 = js_port as u16;

  if let Some(map) = UMQT_MAP.get() {
    if let Some(umqt) = map.lock().unwrap().get(&id) {
      umqt.add_server(&topic, &host, port);
    }
  }

  Ok(cx.undefined())
}

fn umqt_create(mut cx: FunctionContext) -> JsResult<JsNumber> {
  let js_opts: String = cx.argument::<JsString>(0)?.value(&mut cx);
  let opts: JSON = match serde_json::from_str(&js_opts) {
    Ok(json) => json,
    Err(_) => {
      println!("[Arnelify Broker]: NEON error in umqt_create: Invalid JSON in 'c_opts'.");
      return Ok(cx.number(0.0));
    }
  };

  let id: &Mutex<u64> = UMQT_ID.get_or_init(|| Mutex::new(0));
  let new_id: u64 = {
    let mut js: MutexGuard<'_, u64> = id.lock().unwrap();
    *js += 1;
    *js
  };

  let uds_opts: UnixDomainSocketOpts = UnixDomainSocketOpts {
    block_size_kb: get_usize(&opts, "block_size_kb"),
    socket_path: get_str(&opts, "socket_path"),
    thread_limit: get_u64(&opts, "thread_limit"),
  };

  let uds: UnixDomainSocket = UnixDomainSocket::new(uds_opts);
  let uds_map: &Mutex<HashMap<u64, Arc<UnixDomainSocket>>> =
    UMQT_UDS_MAP.get_or_init(|| Mutex::new(HashMap::new()));
  {
    uds_map.lock().unwrap().insert(new_id as u64, Arc::new(uds));
  }

  let umqt_opts: UMQTOpts = UMQTOpts {
    block_size_kb: get_usize(&opts, "block_size_kb"),
    cert_pem: get_str(&opts, "cert_pem"),
    compression: get_bool(&opts, "compression"),
    key_pem: get_str(&opts, "key_pem"),
    port: get_u16(&opts, "port"),
    thread_limit: get_u64(&opts, "thread_limit"),
  };

  let umqt: UMQT = UMQT::new(umqt_opts);
  let umqt_map: &Mutex<HashMap<u64, Arc<UMQT>>> =
    UMQT_MAP.get_or_init(|| Mutex::new(HashMap::new()));
  {
    umqt_map
      .lock()
      .unwrap()
      .insert(new_id as u64, Arc::new(umqt));
  }

  Ok(cx.number(new_id as f64))
}

fn umqt_destroy(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let id: u64 = js_id as u64;

  if let Some(map) = UMQT_MAP.get() {
    map.lock().unwrap().remove(&id);
  }

  if let Some(map) = UMQT_UDS_MAP.get() {
    map.lock().unwrap().remove(&id);
  }

  Ok(cx.undefined())
}

fn umqt_logger(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let id: u64 = js_id as u64;

  let ws_logger: Arc<UMQTLogger> = Arc::new(move |level: &str, message: &str| -> () {
    let args: JSON = serde_json::json!([level, message]);
    let bytes: UnixDomainSocketBytes = Vec::new();

    if let Some(map) = UMQT_UDS_MAP.get() {
      if let Some(uds) = map.lock().unwrap().get(&id) {
        uds.send("umqt_logger", &args, bytes, true);
      }
    }
  });

  if let Some(map) = UMQT_MAP.get() {
    if let Some(umqt) = map.lock().unwrap().get(&id) {
      umqt.logger(ws_logger);
    }
  }

  Ok(cx.undefined())
}

fn umqt_on(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let topic: String = cx.argument::<JsString>(1)?.value(&mut cx);
  let id: u64 = js_id as u64;

  let topic_safe: String = topic.clone();
  let umqt_consumer: Arc<UMQTConsumer> = Arc::new(move |bytes: Arc<Mutex<UMQTBytes>>| -> () {
    let bytes: UMQTBytes = bytes.lock().unwrap().clone();
    let args: JSON = serde_json::json!([topic_safe]);

    if let Some(map) = UMQT_UDS_MAP.get() {
      if let Some(uds) = map.lock().unwrap().get(&id) {
        uds.send("umqt_on", &args, bytes, true);
      }
    }
  });

  if let Some(map) = UMQT_MAP.get() {
    if let Some(umqt) = map.lock().unwrap().get(&id) {
      umqt.on(&topic, umqt_consumer);
    }
  }

  Ok(cx.undefined())
}

fn umqt_send(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let topic: String = cx.argument::<JsString>(1)?.value(&mut cx);
  let js_bytes: Handle<'_, JsBuffer> = cx.argument::<JsBuffer>(2)?;
  let js_is_reliable: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);

  let id: u64 = js_id as u64;
  let bytes: &[u8] = js_bytes.as_slice(&cx);
  let is_reliable: bool = js_is_reliable as u8 == 1;

  if let Some(map) = UMQT_MAP.get() {
    if let Some(umqt) = map.lock().unwrap().get(&id) {
      umqt.send(&topic, bytes, is_reliable);
    }
  }

  Ok(cx.undefined())
}

fn umqt_start_ipc(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let id: u64 = js_id as u64;

  let (tx, rx) = mpsc::channel::<u8>();

  if let Some(map) = UMQT_UDS_MAP.get() {
    if let Some(uds) = map.lock().unwrap().get(&id) {
      let uds_safe: Arc<UnixDomainSocket> = Arc::clone(&uds);
      thread::spawn(move || {
        uds_safe.start(Arc::new(move || {
          let _ = tx.send(1);
        }));
      });
    }
  }

  loop {
    match rx.recv() {
      Ok(1) => break,
      Ok(_) => continue,
      Err(_) => break,
    }
  }

  Ok(cx.undefined())
}

fn umqt_start(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let id: u64 = js_id as u64;

  if let Some(map) = UMQT_MAP.get() {
    if let Some(umqt) = map.lock().unwrap().get(&id) {
      let umqt_safe: Arc<UMQT> = Arc::clone(&umqt);
      thread::spawn(move || {
        umqt_safe.start();
      });
    }
  }

  Ok(cx.undefined())
}

fn umqt_stop(mut cx: FunctionContext) -> JsResult<JsUndefined> {
  let js_id: f64 = cx.argument::<JsNumber>(0)?.value(&mut cx);
  let id: u64 = js_id as u64;

  if let Some(map) = UMQT_UDS_MAP.get() {
    if let Some(uds) = map.lock().unwrap().get(&id) {
      uds.stop();
    }
  }

  if let Some(map) = UMQT_MAP.get() {
    if let Some(ws) = map.lock().unwrap().get(&id) {
      ws.stop();
    }
  }

  Ok(cx.undefined())
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
  cx.export_function("umqt_add_server", umqt_add_server)?;
  cx.export_function("umqt_create", umqt_create)?;
  cx.export_function("umqt_destroy", umqt_destroy)?;
  cx.export_function("umqt_logger", umqt_logger)?;
  cx.export_function("umqt_on", umqt_on)?;
  cx.export_function("umqt_send", umqt_send)?;
  cx.export_function("umqt_start_ipc", umqt_start_ipc)?;
  cx.export_function("umqt_start", umqt_start)?;
  cx.export_function("umqt_stop", umqt_stop)?;

  Ok(())
}
