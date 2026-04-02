<img src="https://static.wikia.nocookie.net/arnelify/images/c/c8/Arnelify-logo-2024.png/revision/latest?cb=20240701012515" style="width:336px;" alt="Arnelify Logo" />

![Arnelify Broker for NodeJS](https://img.shields.io/badge/Arnelify%20Broker%20for%20NodeJS-1.0.5-yellow) ![NodeJS](https://img.shields.io/badge/NodeJS-24.14.1-green) ![Bun](https://img.shields.io/badge/Bun-1.3.6-blue)

## 🚀 About

**Arnelify® Broker for NodeJS** — a multi-language broker with RPC and UMQT support.

All supported protocols:
| **#** | **Protocol** | **Transport** |
| - | - | - |
| 1 | TCP2 | UMQT |
| 2 | UDP | UMQT |

## 📋 Minimal Requirements
> Important: It's strongly recommended to use in a container that has been built from the gcc v15.2.0 image.
* CPU: Apple M1 / Intel Core i7 / AMD Ryzen 7
* OS: Debian 11 / MacOS 15 / Windows 10 with <a href="https://learn.microsoft.com/en-us/windows/wsl/install">WSL2</a>.
* RAM: 4 GB

## 📦 Installation
Run in terminal:
```bash
yarn add arnelify-server
```
## 🎉 RPC
**RPC** - operates on top of the transport layer, enabling remote function and procedure calls.

### 📚 Examples

```typescript
import { 
  RPC, 
  BrokerBytes, 
  BrokerCtx, 
  RPCStream
} from "arnelify-server";

(async function main() {

  const rpc: RPC = new RPC();
  rpc.logger((level: string, message: string): void => {
    console.log(`[Arnelify Broker]: ${message}`);
  });

  rpc.on("connect", (ctx: BrokerCtx, bytes: BrokerBytes, stream: RPCStream): void => {
    await stream.push(ctx, bytes);
  });

  const { ctx, bytes } = await rpc.send_json("connect", { test: 1 });
  console.log("ctx: ", ctx);
  console.log("bytes: ", bytes);

})();
```

## 🎉 UMQT
**UMQT (UDP Message Query Transport)** - is a universal WEB3-transport designed for flexible transport-layer communication, supporting two messaging mechanisms: TCP2 and datagrams.

### 📚 Configuration

| **Option** | **Description** |
| - | - |
| **BLOCK_SIZE_KB**| The size of the allocated memory used for processing large packets. |
| **CERT_PEM**| Path to the TLS cert-file in PEM format. |
| **COMPRESSION**| If this option is enabled, the transport will use BROTLI compression if the client application supports it. This setting increases CPU resource consumption. The transport will not use compression if the data size exceeds the value of **BLOCK_SIZE_KB**. |
| **KEY_PEM**| Path to the TLS private key-file in PEM format. |
| **PORT**| Defines which port the transport will listen on. |
| **THREAD_LIMIT**| Defines the maximum number of threads that will handle requests. |

### 📚 Examples

```typescript
import { 
  UMQT, 
  UMQTBytes, 
  UMQTConsumer, 
  UMQTOpts
} from "arnelify-server";

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
  umqt.logger((level: string, message: string): void => {
    console.log(`[Arnelify Server]: ${message}`);
  });

  umqt.on("connect", (bytes: UMQTBytes): void => {
    console.log("received: ", bytes);
  });

  umqt.start();

})();
```

## ⚖️ MIT License
This software is licensed under the <a href="https://github.com/arnelify/arnelify-broker-node/blob/main/LICENSE">MIT License</a>. The original author's name, logo, and the original name of the software must be included in all copies or substantial portions of the software.

## 🛠️ Contributing
Join us to help improve this software, fix bugs or implement new functionality. Active participation will help keep the software up-to-date, reliable, and aligned with the needs of its users.

Run in terminal:
```bash
docker compose up -d --build
docker ps
docker exec -it <CONTAINER ID> bash
yarn build
```
For RPC:
```bash
yarn test_rpc
```
For UMQT:
```bash
yarn test_umqt
```

## ⭐ Release Notes
Version 1.0.5 — a multi-language broker with RPC and UMQT support.

We are excited to introduce the Arnelify Broker for NodeJS! Please note that this version is raw and still in active development.

Change log:

* UMQT support.
* Async Runtime & Multi-Threading.
* Block processing in "on-the-fly" mode.
* BROTLI compression (still in development).
* FFI, PYO3 and NEON support.
* Significant refactoring and optimizations.

Please use this version with caution, as it may contain bugs and unfinished features. We are actively working on improving and expanding the broker's capabilities, and we welcome your feedback and suggestions.

## 🔗 Links

* <a href="https://github.com/arnelify/arnelify-pod-cpp">Arnelify POD for C++</a>
* <a href="https://github.com/arnelify/arnelify-pod-node">Arnelify POD for NodeJS</a>
* <a href="https://github.com/arnelify/arnelify-pod-python">Arnelify POD for Python</a>
* <a href="https://github.com/arnelify/arnelify-pod-rust">Arnelify POD for Rust</a>
* <a href="https://github.com/arnelify/arnelify-react-native">Arnelify React Native</a>