import { BrokerBytes, BrokerCtx, RPC, RPCStream } from "../../build";

(async function main() {

  const rpc = new RPC();
  rpc.logger(async (level: string, message: string): Promise<void> => {
    console.log(`[Arnelify Broker]: ${message}`);
  });

  rpc.on("connect", async (
    ctx: BrokerCtx,
    bytes: BrokerBytes,
    stream: RPCStream
  ): Promise<void> => {
    await stream.push(ctx, bytes);
  });

  const message = { message: "Hello World" };
  const json: Record<string, any> = { message };
  const buff: Buffer = Buffer.from("Hello World");
  
  const { ctx, bytes } = await rpc.send("connect", json, buff, true);

  console.log("ctx: ", JSON.stringify(ctx));
  console.log("bytes: ", bytes);

})();