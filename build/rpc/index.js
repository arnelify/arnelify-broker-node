"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RPCStream = exports.RPC = void 0;
const MAP = new Map();
function generate_request_id() {
    const unixtime = Date.now().toString()
        + process.hrtime.bigint().toString();
    return BigInt(unixtime.slice(0, -2));
}
class RPCReq {
    constructor() {
        this.has_body = false;
        this.has_meta = false;
        this.buff = Buffer.alloc(0);
        this.binary = Buffer.alloc(0);
        this.compression = null;
        this.binary_length = 0;
        this.json_length = 0;
        this.request_id = 0n;
        this.ctx = {
            "topic": null,
            "payload": {},
            "request_id": "0",
            "reliable": false
        };
    }
    add(buff) {
        this.buff = Buffer.concat([
            this.buff,
            buff
        ]);
    }
    get_bytes() {
        return this.binary;
    }
    get_ctx() {
        return this.ctx;
    }
    get_request_id() {
        return this.request_id;
    }
    is_empty() {
        return this.buff.length === 0;
    }
    read_meta(meta_end) {
        const meta_bytes = this.buff.subarray(0, meta_end);
        const pos = meta_bytes.indexOf(43);
        if (pos === -1)
            return 'Missing \'+\' in meta';
        const json_length = Number(meta_bytes.subarray(0, pos));
        const binary_length = Number(meta_bytes.subarray(pos + 1));
        if (!Number.isInteger(json_length) || !Number.isInteger(binary_length)) {
            return 'Invalid meta.';
        }
        this.json_length = json_length;
        this.binary_length = binary_length;
        return 1;
    }
    read_body() {
        if (!this.has_meta) {
            const meta_end = this.buff.indexOf(58);
            if (meta_end === -1) {
                if (this.buff.length > 8192) {
                    this.buff = Buffer.alloc(0);
                    return 'The maximum size of the meta has been exceeded.';
                }
                return null;
            }
            const res = this.read_meta(meta_end);
            if (typeof res === 'string')
                return res;
            this.has_meta = true;
            this.buff = this.buff.subarray(meta_end + 1);
        }
        if (this.json_length !== 0 && this.buff.length >= this.json_length) {
            const raw = this.buff
                .subarray(0, this.json_length)
                .toString();
            let json = {};
            try {
                json = JSON.parse(raw);
            }
            catch {
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
    read_block() {
        if (!this.has_body) {
            const res = this.read_body();
            if (typeof res === 'string')
                return res;
            if (res === null)
                return null;
        }
        return 1;
    }
    reset() {
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
    constructor() {
        this.topic = "";
        this.request_id = 0n;
        this.cb_send = async (topic, bytes) => {
            console.log(topic, bytes);
        };
    }
    on_send(cb) {
        this.cb_send = cb;
    }
    async push(payload, bytes, is_reliable = true) {
        const json = Buffer.from(JSON.stringify({
            topic: this.topic,
            request_id: String(this.request_id),
            payload,
            reliable: is_reliable
        }));
        bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
        const buff = Buffer.concat([meta, json, bytes]);
        await this.cb_send(this.topic, buff);
    }
    async push_bytes(bytes, is_reliable) {
        const json = Buffer.from(JSON.stringify({
            topic: this.topic,
            request_id: String(this.request_id),
            payload: "<bytes>",
            reliable: is_reliable
        }));
        bytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        const meta = Buffer.from(`${json.length}+${bytes.length}:`, 'utf8');
        const buff = Buffer.concat([meta, json, bytes]);
        await this.cb_send(this.topic, buff);
    }
    async push_json(payload, is_reliable = false) {
        const json = Buffer.from(JSON.stringify({
            topic: this.topic,
            request_id: String(this.request_id),
            payload,
            reliable: is_reliable
        }));
        const meta = Buffer.from(`${json.length}+0:`, 'utf8');
        const buff = Buffer.concat([meta, json, Buffer.alloc(0)]);
        await this.cb_send(this.topic, buff);
    }
    async send(topic, payload, bytes, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
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
            this.cb_send(req_topic, buff);
        });
        MAP.delete(request_id);
        return response;
    }
    async send_bytes(topic, bytes, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
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
            this.cb_send(req_topic, buff);
        });
        MAP.delete(request_id);
        return response;
    }
    async send_json(topic, payload, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
            MAP.set(request_id, resolve);
            const json = Buffer.from(JSON.stringify({
                topic: req_topic,
                request_id: String(request_id),
                payload,
                reliable: is_reliable
            }));
            const meta = Buffer.from(`${json.length}+0:`, 'utf8');
            const buff = Buffer.concat([meta, json, Buffer.alloc(0)]);
            this.cb_send(req_topic, buff);
        });
        MAP.delete(request_id);
        return response;
    }
    set_request_id(request_id) {
        this.request_id = request_id;
    }
    set_response_topic(topic) {
        this.topic = topic;
    }
}
exports.RPCStream = RPCStream;
class RPC {
    constructor() {
        this.consumers = new Map();
        this.cb_logger = async (_level, message) => {
            console.log(`[Arnelify Broker]: ${message}`);
        };
        this.cb_consumer = (topic, cb) => {
            this.consumers.set(topic, cb);
        };
        this.cb_producer = async (topic, bytes) => {
            const consumer = this.consumers.get(topic);
            if (consumer)
                await consumer(bytes);
        };
    }
    logger(cb) {
        this.cb_logger = cb;
    }
    on(topic, cb) {
        const p_req_topic = `req:${topic}`;
        const c_res_topic = `res:${topic}`;
        const p_res_topic = `res:${topic}`;
        const req_consumer = async (bytes) => {
            const req = new RPCReq();
            req.add(bytes);
            const res = req.read_block();
            if (res === 1) {
                const ctx = req.get_ctx();
                const bytes = req.get_bytes();
                const stream = new RPCStream();
                stream.set_response_topic(c_res_topic);
                stream.set_request_id(req.get_request_id());
                stream.on_send(async (topic, bytes) => {
                    await this.cb_producer(topic, bytes);
                });
                req.reset();
                // Broker Action
                await cb(ctx, bytes, stream);
            }
            else if (typeof res === "string") {
                await this.cb_logger("warning", `Block read error: ${res}`);
            }
        };
        const res_consumer = async (bytes) => {
            const req = new RPCReq();
            req.add(bytes);
            const res = req.read_block();
            if (res === 1) {
                const ctx = req.get_ctx();
                const bytes = req.get_bytes();
                const request_id = req.get_request_id();
                req.reset();
                const resolve = MAP.get(request_id);
                if (resolve)
                    resolve({ ctx, bytes });
            }
            else if (typeof res === "string") {
                await this.cb_logger("warning", `Block read error: ${res}`);
            }
        };
        this.cb_consumer(p_req_topic, req_consumer);
        this.cb_consumer(p_res_topic, res_consumer);
    }
    async send(topic, payload, bytes, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
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
    async send_bytes(topic, bytes, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
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
    async send_json(topic, payload, is_reliable = true) {
        const request_id = generate_request_id();
        const req_topic = `req:${topic}`;
        const response = await new Promise((resolve) => {
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
    set_consumer(cb) {
        this.cb_consumer = cb;
    }
    set_producer(cb) {
        this.cb_producer = cb;
    }
}
exports.RPC = RPC;
