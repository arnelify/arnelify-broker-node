import { UnixDomainSocket } from "../ipc/uds";
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
declare class UMQT {
    id: number;
    opts: UMQTOpts;
    handlers: Record<string, UMQTConsumer>;
    socket_path: string;
    uds: UnixDomainSocket;
    constructor(opts: UMQTOpts);
    add_server(topic: string, host: string, port: number): void;
    logger(cb: (level: string, message: string) => Promise<void>): void;
    on(topic: string, cb: UMQTConsumer): void;
    send(topic: string, bytes: Buffer, is_reliable?: boolean): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export type { UMQTBytes, UMQTConsumer, UMQTOpts };
export { UMQT };
//# sourceMappingURL=umqt.d.ts.map