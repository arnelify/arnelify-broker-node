type BrokerCtx = Record<string, any>;
type BrokerBytes = Buffer;
declare class RPCStream {
    topic: string;
    request_id: BigInt;
    sent: boolean;
    cb_send: (topic: string, bytes: Buffer) => Promise<void>;
    on_send(cb: (topic: string, bytes: Buffer) => Promise<void>): void;
    is_response_sent(): boolean;
    push(payload: any, bytes: Buffer, is_reliable?: boolean): Promise<void>;
    push_bytes(bytes: Buffer, is_reliable: boolean): Promise<void>;
    push_json(payload: any, is_reliable?: boolean): Promise<void>;
    send(topic: string, payload: any, bytes: Buffer, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    send_bytes(topic: string, bytes: Buffer, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    send_json(topic: string, payload: any, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    set_request_id(request_id: BigInt): void;
    set_response_topic(topic: string): void;
}
type RPCAction = (ctx: BrokerCtx, bytes: BrokerBytes, stream: RPCStream) => Promise<void>;
type RPCLogger = (level: string, message: string) => Promise<void>;
type BrokerConsumer = (bytes: BrokerBytes) => Promise<void>;
type BrokerConsumerHandler = (topic: string, cb: BrokerConsumer) => void;
type BrokerProducer = (topic: string, bytes: BrokerBytes) => Promise<void>;
declare class RPC {
    consumers: Map<string, BrokerConsumer>;
    topics: string[];
    cb_after: RPCAction;
    cb_before: RPCAction;
    cb_logger: RPCLogger;
    cb_consumer: (topic: string, cb: BrokerConsumer) => void;
    cb_producer: (topic: string, bytes: BrokerBytes) => Promise<void>;
    has_local_topic(topic: string): boolean;
    logger(cb: RPCLogger): void;
    on(topic: string, cb: RPCAction): void;
    send(topic: string, payload: any, bytes: Buffer, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    send_bytes(topic: string, bytes: Buffer, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    send_json(topic: string, payload: any, is_reliable?: boolean): Promise<Record<string, BrokerCtx | BrokerBytes>>;
    set_consumer(cb: BrokerConsumerHandler): void;
    set_producer(cb: BrokerProducer): void;
}
export type { BrokerCtx, BrokerBytes };
export { RPC, RPCStream };
//# sourceMappingURL=index.d.ts.map