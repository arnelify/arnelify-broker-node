// MIT LICENSE

// COPYRIGHT (R) 2025 ARNELIFY. AUTHOR: TARON SARKISYAN

// PERMISSION IS HEREBY GRANTED, FREE OF CHARGE, TO ANY PERSON OBTAINING A COPY
// OF THIS SOFTWARE AND ASSOCIATED DOCUMENTATION FILES (THE "SOFTWARE"), TO DEAL
// IN THE SOFTWARE WITHOUT RESTRICTION, INCLUDING WITHOUT LIMITATION THE RIGHTS
// TO USE, COPY, MODIFY, MERGE, PUBLISH, DISTRIBUTE, SUBLICENSE, AND/OR SELL
// COPIES OF THE SOFTWARE, AND TO PERMIT PERSONS TO WHOM THE SOFTWARE IS
// FURNISHED TO DO SO, SUBJECT TO THE FOLLOWING CONDITIONS:

// THE ABOVE COPYRIGHT NOTICE AND THIS PERMISSION NOTICE SHALL BE INCLUDED IN ALL
// COPIES OR SUBSTANTIAL PORTIONS OF THE SOFTWARE.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const native = require("../../native");

import {
  UnixDomainSocket, UnixDomainSocketBytes,
  UnixDomainSocketCtx, UnixDomainSocketOpts
} from "../ipc/uds";

type UMQTOpts = {
  block_size_kb: number;
  cert_pem: string;
  compression: boolean;
  key_pem: string;
  port: number;
  thread_limit: number;
};

type UMQTBytes = Buffer;

type UMQTConsumer = (ctx: UMQTBytes) => Promise<void>;

class UMQT {
  id: number = 0;
  opts: UMQTOpts;
  handlers: Record<string, UMQTConsumer> = {};
  socket_path: string = '/var/run/arnelify_broker.sock';
  uds: UnixDomainSocket;

  constructor(opts: UMQTOpts) {
    this.opts = opts;

    const uds_opts: UnixDomainSocketOpts = {
      block_size_kb: opts.block_size_kb,
      socket_path: this.socket_path,
      thread_limit: opts.thread_limit
    };

    this.uds = new UnixDomainSocket(uds_opts);
    this.id = native.umqt_create(JSON.stringify({
      socket_path: this.socket_path,
      ...this.opts,
    }));
  }

  add_server(topic: string, host: string, port: number): void {
    native.umqt_add_server(this.id, topic, host, port);
  }

  logger(cb: (level: string, message: string) => Promise<void>): void {
    this.uds.on('umqt_logger', async (ctx: UnixDomainSocketCtx, _bytes: UnixDomainSocketBytes): Promise<void> => {
      const [level, message] = ctx;
      await cb(level, message);
    });
  }

  on(topic: string, cb: UMQTConsumer): void {
    this.handlers[topic] = cb;

    this.uds.on('umqt_on', async (ctx: UnixDomainSocketCtx, bytes: UnixDomainSocketBytes): Promise<void> => {
      const [topic] = ctx;
      const cb = this.handlers[topic];
      if (cb) await cb(bytes);
    });

    native.umqt_on(this.id, topic);
  }

  async send(topic: string, bytes: Buffer, is_reliable: boolean = true): Promise<void> {
    native.umqt_send(this.id, topic, bytes, is_reliable ? 1 : 0);
  }

  async start(): Promise<void> {
    native.umqt_start_ipc(this.id);
    await this.uds.start();
    native.umqt_start(this.id);
  }

  async stop(): Promise<void> {
    native.umqt_stop(this.id);
    await this.uds.stop();
  }
}

export type { UMQTBytes, UMQTConsumer, UMQTOpts };
export { UMQT };