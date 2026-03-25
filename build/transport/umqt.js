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
exports.UMQT = void 0;
const native = require("../../native");
const uds_1 = require("../ipc/uds");
class UMQT {
    constructor(opts) {
        this.id = 0;
        this.handlers = {};
        this.socket_path = '/var/run/arnelify_broker.sock';
        this.opts = opts;
        const uds_opts = {
            block_size_kb: opts.block_size_kb,
            socket_path: this.socket_path,
            thread_limit: opts.thread_limit
        };
        this.uds = new uds_1.UnixDomainSocket(uds_opts);
        this.id = native.umqt_create(JSON.stringify({
            socket_path: this.socket_path,
            ...this.opts,
        }));
    }
    add_server(topic, host, port) {
        native.umqt_add_server(this.id, topic, host, port);
    }
    logger(cb) {
        this.uds.on('umqt_logger', async (ctx, _bytes) => {
            const [level, message] = ctx;
            await cb(level, message);
        });
    }
    on(topic, cb) {
        this.handlers[topic] = cb;
        this.uds.on('umqt_on', async (ctx, bytes) => {
            const [topic] = ctx;
            const cb = this.handlers[topic];
            if (cb)
                await cb(bytes);
        });
        native.umqt_on(this.id, topic);
    }
    async send(topic, bytes, is_reliable = true) {
        native.umqt_send(this.id, topic, bytes, is_reliable ? 1 : 0);
    }
    async start() {
        native.umqt_start_ipc(this.id);
        await this.uds.start();
        native.umqt_start(this.id);
    }
    async stop() {
        native.umqt_stop(this.id);
        await this.uds.stop();
    }
}
exports.UMQT = UMQT;
