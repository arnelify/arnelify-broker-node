import { 
  UMQT, UMQTBytes, UMQTConsumer, UMQTOpts
} from "../../build";

(async function main() {

  const umqt_opts: UMQTOpts = {
    block_size_kb: 64,
    cert_pem: "certs/cert.pem",
    compression: true,
    key_pem: "certs/key.pem",
    port: 4433,
    thread_limit: 4
  };

  const umqt = new UMQT(umqt_opts);

  umqt.add_server("connect", "127.0.0.1", 4433);
  umqt.logger(async (level: string, message: string): Promise<void> => {
    console.log(`[Arnelify Server]: ${message}`);
  });

  umqt.on("connect", async (bytes: UMQTBytes): Promise<void> => {
    console.log("received: ", bytes);
  });

  await umqt.start();

})();