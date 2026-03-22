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

const MAP: Map<BigInt, CallableFunction> = new Map();

type BrokerCtx = Record<string, any>;
type BrokerBytes = Buffer;

function generate_request_id(): BigInt {
  const unixtime: string = Date.now().toString() 
    + process.hrtime.bigint().toString();
  return BigInt(unixtime.slice(0, -2));
}

class RPCReq {
  has_body: boolean = false;
  has_meta: boolean = false;

  buff: Buffer = Buffer.alloc(0);
  binary: Buffer = Buffer.alloc(0);

  compression: null | string = null;
  binary_length: number = 0;
  json_length: number = 0;

  request_id: BigInt = 0n;
  ctx: BrokerCtx = {
    "topic": null,
    "payload": {},
    "request_id": "0",
    "reliable": false
  };

  add(buff: Buffer): void {
    this.buff = Buffer.concat([
      this.buff,
      buff
    ]);
  }

  get_bytes(): BrokerBytes {
    return this.binary;
  }

  get_ctx(): BrokerCtx {
    return this.ctx;
  }

  get_request_id(): BigInt {
    return this.request_id;
  }

  is_empty(): boolean {
    return this.buff.length === 0;
  }

  read_meta(meta_end: number): string | number {
    const meta_bytes: Buffer = this.buff.subarray(0, meta_end);
    const pos: number = meta_bytes.indexOf(43);
    if (pos === -1) return 'Missing \'+\' in meta';

    const json_length: number = Number(meta_bytes.subarray(0, pos));
    const binary_length: number = Number(meta_bytes.subarray(pos + 1));
    if (!Number.isInteger(json_length) || !Number.isInteger(binary_length)) {
      return 'Invalid meta.';
    }

    this.json_length = json_length;
    this.binary_length = binary_length;

    return 1;
  }

  read_body(): null | string | number {
    if (!this.has_meta) {
      const meta_end: number = this.buff.indexOf(58);
      if (meta_end === -1) {
        if (this.buff.length > 8192) {
          this.buff = Buffer.alloc(0);
          return 'The maximum size of the meta has been exceeded.';
        }

        return null;
      }

      const res: string | number = this.read_meta(meta_end);
      if (typeof res === 'string') return res;

      this.has_meta = true;
      this.buff = this.buff.subarray(meta_end + 1);
    }

    if (this.json_length !== 0 && this.buff.length >= this.json_length) {
      const raw: string = this.buff
        .subarray(0, this.json_length)
        .toString();

      let json: { [key: string]: any } = {};
      try {
        json = JSON.parse(raw);
      } catch {
        this.buff = Buffer.alloc(0);
        return 'Invalid JSON.';
      }

      if (!json.hasOwnProperty('topic')
        || !json.hasOwnProperty('request_id')
        || !json.hasOwnProperty('payload')) {
        this.buff = Buffer.alloc(0);
        return 'Invalid message.';
      }

      this.request_id = BigInt(json.request_id);
      this.ctx = json.payload;
      this.buff = this.buff.subarray(this.json_length);
      if (this.binary_length === 0) {
        this.has_body = true;
        return 1;
      }
    }

    if (this.binary_length !== 0 && this.buff.length >= this.binary_length) {
      this.binary = this.buff.subarray(0, this.binary_length);
      this.buff = this.buff.subarray(this.binary_length);
      this.has_body = true;
      return 1;
    }

    return null;
  }

  read_block(): null | string | number {
    if (!this.has_body) {
      const res: null | string | number = this.read_body();
      if (typeof res === 'string') return res;
      if (res === null) return null;
    }

    return 1;
  }

  reset(): void {
    this.has_meta = false;
    this.has_body = false;

    this.request_id = 0n;
    this.binary = Buffer.alloc(0);

    this.json_length = 0;
    this.binary_length = 0;
    this.ctx = {
      "topic": null,
      "payload": {},
      "request_id": "0",
      "reliable": false
    };
  }
}

class RPCStream {
  topic: string = "";
  request_id: BigInt = 0n;

  cb_send: (bytes: Buffer) => Promise<void> =
    async (bytes: Buffer): Promise<void> => {
      console.log(bytes);
    };

  on_send(cb: (bytes: Buffer) => Promise<void>): void {
    this.cb_send = cb;
  }

  async push(payload: any, bytes: Buffer, is_reliable: boolean = true): Promise<void> {
    const json = Buffer.from(JSON.stringify({
      topic: this.topic,
      request_id: String(this.request_id),
      payload,
      reliable: is_reliable
    }));

    bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
    const buff = Buffer.concat([meta, json, bytes]);
    await this.cb_send(buff);
  }

  async push_bytes(bytes: Buffer, is_reliable: boolean): Promise<void> {
    const json = Buffer.from(JSON.stringify({
      topic: this.topic,
      request_id: String(this.request_id),
      payload: "<bytes>",
      reliable: is_reliable
    }));

    bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
    const buff = Buffer.concat([meta, json, bytes]);
    await this.cb_send(buff);
  }

  async push_json(payload: any, is_reliable: boolean = false): Promise<void> {
    const json = Buffer.from(JSON.stringify({
      topic: this.topic,
      request_id: String(this.request_id),
      payload,
      reliable: is_reliable
    }));

    const meta = Buffer.from(`${json.length}+0:`, 'utf8');
    const buff = Buffer.concat([meta, json, Buffer.alloc(0)]);
    await this.cb_send(buff);
  }

  async send(topic: string, payload: any, bytes: Buffer, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();
    const response: Record<string, BrokerCtx | BrokerBytes> =
      await new Promise((resolve): void => {
        MAP.set(request_id, resolve);
        const json = Buffer.from(JSON.stringify({
          topic: topic,
          request_id: String(request_id),
          payload,
          reliable: is_reliable
        }));

        bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
        const buff = Buffer.concat([meta, json, bytes]);
        this.cb_send(buff);
      });

    MAP.delete(request_id);
    return response;
  }

  async send_bytes(topic: string, bytes: Buffer, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();
    const response: Record<string, BrokerCtx | BrokerBytes> =
      await new Promise((resolve): void => {
        MAP.set(request_id, resolve);
        const json = Buffer.from(JSON.stringify({
          topic: topic,
          request_id: String(request_id),
          payload: "<bytes>",
          reliable: is_reliable
        }));

        bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
        const buff = Buffer.concat([meta, json, bytes]);
        this.cb_send(buff);
      });

    MAP.delete(request_id);
    return response;
  }

  async send_json(topic: string, payload: any, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();

    const response: Record<string, BrokerCtx | BrokerBytes> =
      await new Promise((resolve): void => {
        MAP.set(request_id, resolve);
        const json = Buffer.from(JSON.stringify({
          topic: topic,
          request_id: String(request_id),
          payload,
          reliable: is_reliable
        }));

        const meta = Buffer.from(`${json.length}+0:`, 'utf8');
        const buff = Buffer.concat([meta, json, Buffer.alloc(0)]);
        this.cb_send(buff);
      });

    MAP.delete(request_id);
    return response;
  }

  set_request_id(request_id: BigInt): void {
    this.request_id = request_id;
  }

  set_topic(topic: string): void {
    this.topic = topic;
  }
}

type RPCAction = (ctx: BrokerCtx, bytes: BrokerBytes, stream: RPCStream) => Promise<void>;
type RPCLogger = (level: string, message: string) => Promise<void>;

type BrokerConsumer = (bytes: BrokerBytes) => Promise<void>;
type BrokerConsumerHandler = (topic: string, cb: BrokerConsumer) => void;
type BrokerProducer = (topic: string, bytes: BrokerBytes) => Promise<void>;

class RPC {
  consumers: Map<string, BrokerConsumer> = new Map();

  cb_logger: RPCLogger = async (_level: string, message: string): Promise<void> => {
    console.log(message);
  };

  cb_consumer = (topic: string, cb: BrokerConsumer): void => {
    this.consumers.set(topic, cb);
  };

  cb_producer = async (topic: string, bytes: BrokerBytes): Promise<void> => {
    const consumer = this.consumers.get(topic);
    if (consumer) await consumer(bytes);
  };

  logger(cb: RPCLogger): void {
    this.cb_logger = cb;
  }

  on(topic: string, cb: RPCAction): void {
    const p_req_topic: string = `req:${topic}`;
    const c_res_topic: string = `res:${topic}`;
    const p_res_topic: string = `res:${topic}`;

    const req_consumer: BrokerConsumer = async (bytes: BrokerBytes): Promise<void> => {
      const req: RPCReq = new RPCReq();
      req.add(bytes);
      const res: null | string | number = req.read_block();
      if (res === 1) {
        const ctx = req.get_ctx();
        const bytes = req.get_bytes();
        const stream = new RPCStream();
        stream.set_topic(c_res_topic);
        stream.set_request_id(req.get_request_id());
        stream.on_send(async (bytes: BrokerBytes): Promise<void> => {
          await this.cb_producer(c_res_topic, bytes);
        });

        req.reset();

        // Broker Action
        await cb(ctx, bytes, stream);

      } else if (typeof res === "string") {
        await this.cb_logger("warning", `Block read error: ${res}`);
      }
    };

    const res_consumer: BrokerConsumer = async (bytes: BrokerBytes): Promise<void> => {
      const req: RPCReq = new RPCReq();
      req.add(bytes);

      const res: null | string | number = req.read_block();
      if (res === 1) {
        const ctx = req.get_ctx();
        const bytes = req.get_bytes();
        const request_id = req.get_request_id();
        req.reset();

        const resolve = MAP.get(request_id);
        if (resolve) resolve({ ctx, bytes });
      } else if (typeof res === "string") {
        await this.cb_logger("warning", `Block read error: ${res}`);
      }
    };

    this.cb_consumer(p_req_topic, req_consumer);
    this.cb_consumer(p_res_topic, res_consumer);
  }

  async send(topic: string, payload: any, bytes: Buffer, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();
    const req_topic: string = `req:${topic}`;

    const response: Record<string, BrokerCtx | BrokerBytes> = await new Promise((resolve) => {
      MAP.set(request_id, resolve);
      const json = Buffer.from(JSON.stringify({
        topic: req_topic,
        request_id: String(request_id),
        payload,
        reliable: is_reliable
      }));

      bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
      const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
      const buff = Buffer.concat([meta, json, bytes]);
      this.cb_producer(req_topic, buff);
    });

    MAP.delete(request_id);
    return response;
  }

  async send_bytes(topic: string, bytes: Buffer, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();
    const req_topic: string = `req:${topic}`;

    const response: Record<string, BrokerCtx | BrokerBytes> = await new Promise((resolve) => {
      MAP.set(request_id, resolve);
      const json = Buffer.from(JSON.stringify({
        topic: req_topic,
        request_id: String(request_id),
        payload: "<bytes>",
        reliable: is_reliable
      }));

      bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
      const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
      const buff = Buffer.concat([meta, json, bytes]);
      this.cb_producer(req_topic, buff);
    });

    MAP.delete(request_id);
    return response;
  }

  async send_json(topic: string, payload: any, is_reliable: boolean = true): Promise<Record<string, BrokerCtx | BrokerBytes>> {
    const request_id: BigInt = generate_request_id();
    const req_topic: string = `req:${topic}`;

    const response: Record<string, BrokerCtx | BrokerBytes> = await new Promise((resolve) => {
      MAP.set(request_id, resolve);
      const json = Buffer.from(JSON.stringify({
        topic: req_topic,
        request_id: String(request_id),
        payload,
        reliable: is_reliable
      }));

      const meta = Buffer.from(`${json.length}+0:`, 'utf8');
      const buff = Buffer.concat([meta, json, Buffer.alloc(0)]);
      this.cb_producer(req_topic, buff);
    });

    MAP.delete(request_id);
    return response;
  }

  set_consumer(cb: BrokerConsumerHandler) {
    this.cb_consumer = cb;
  }

  set_producer(cb: BrokerProducer) {
    this.cb_producer = cb;
  }
}

export type { BrokerCtx, BrokerBytes };
export { RPC, RPCStream };