#!/usr/bin/env bun

import Ctx from "./contracts/ctx";
import Res from "./contracts/res";

/**
 * ArnelifyBroker
 */
class ArnelifyBroker {

  #lib: any = null;
  #actions: { [key: string]: CallableFunction } = {};
  #req: { [key: string]: any } = {};
  #res: { [key: string]: any } = {};

  constructor() {
    this.#lib = require("../build/Release/arnelify-broker.node");
    this.#lib.broker_create();
  }

  /**
   * Callback
   * @param {string} message 
   * @param {boolean} isError 
   */
  #callback = (message: string, isError: boolean): void => {
    if (isError) {
      console.log(`[Arnelify Broker]: NodeJS error: ${message}`);
      return;
    }

    console.log(`[Arnelify Broker]: ${message}`);
  };

  /**
   * Get DateTime
   * @returns
   */
  #getDateTime(): string {
    return this.#lib.broker_get_datetime();
  }

  /**
   * Get UUID
   * @returns 
   */
  #getUuid(): string {
    return this.#lib.broker_get_uuid();
  }

  /**
   * Call
   * @param {string} topic
   * @param {object} params 
   * @returns 
   */
  async call(topic: string, params: { [key: string]: any }): Promise<Res> {
    return this.send(topic, params, async (message: string): Promise<void> => {
      await this.producer(`${topic}:req`, message);
    });
  }

  /**
   * Consumer
   * @param {string} topic
   * @param {CallableFunction} onMessage 
   */
  consumer(topic: string, onMessage: (message: string) => void): void {
    this.#req[topic] = onMessage;
  }

  /**
   * Deserialize
   * @param {string} message
   * @returns 
   */
  deserialize(message: string): { [key: string]: any } {
    const deserialized: string = this.#lib.broker_deserialize(message);
    let json: { [key: string]: any } = {};

    try {
      json = JSON.parse(deserialized);

    } catch (err) {
      this.#callback("Deserialized must be a valid JSON.", true);
      process.exit(1);
    }

    return json;
  }

  /**
   * Handler
   * @param {string} topic
   * @param {Ctx} ctx 
   * @returns 
   */
  async handler(topic: string, ctx: Ctx): Promise<Res> {
    ctx["receivedAt"] = this.#getDateTime();
    const action = this.#actions[topic];
    const res: Res = {};
    res["content"] = await action(ctx);
    res["createdAt"] = ctx["createdAt"];
    res["receivedAt"] = this.#getDateTime();
    res["topic"] = ctx["topic"];
    res["uuid"] = ctx["uuid"];
    return res;
  }

  /**
   * Producer
   * @param {string} topic
   * @param {string} message 
   */
  async producer(topic: string, message: string): Promise<void> {
    const onMessage: (message: string) => Promise<void> = this.#req[topic];
    await onMessage(message);
  }

  /**
   * Receive
   * @param {Res} res
   */
  receive(res: Res): void {
    const uuid: string = res["uuid"];
    const resolve: CallableFunction = this.#res[uuid];
    delete this.#res[uuid];
    resolve(res["content"]);
  }

  /**
   * Send
   * @param {string} topic
   * @param {object} params
   * @param {CallableFunction} producer
   * @returns 
   */
  async send(topic: string, params: { [key: string]: any }, producer: any): Promise<Res> {
    return new Promise(async (resolve): Promise<void> => {
      const uuid: string = this.#getUuid();
      this.#res[uuid] = resolve;

      const ctx: Ctx = {};
      ctx["topic"] = topic;
      ctx["createdAt"] = this.#getDateTime();
      ctx["receivedAt"] = null;
      ctx["params"] = params;
      ctx["uuid"] = uuid;

      const message: string = this.serialize(ctx);
      await producer(message);
    });
  }

  /**
   * Serialize
   * @param {object} json
   * @returns 
   */
  serialize(json: { [key: string]: any }): string {
    return this.#lib.broker_serialize(JSON.stringify(json));
  }

  /**
   * Set Action
   * @param {string} topic 
   * @param {CallableFunction} action 
   */
  setAction(topic: string, action: (ctx: Ctx) => Res): void {
    this.#actions[topic] = action;
  }

  /**
   * Subscribe
   * @param {string} topic
   * @param {CallableFunction} action
   */
  subscribe(topic: string, action: (ctx: Ctx) => Res): void {
    this.setAction(topic, action);

    this.consumer(`${topic}:res`, (message: string): void => {
      const res: Res = this.deserialize(message);
      this.receive(res);
    });

    this.consumer(`${topic}:req`, async (message: string): Promise<void> => {
      const ctx: Ctx = this.deserialize(message);
      const topic: string = ctx["topic"];
      const res: Res = await this.handler(topic, ctx);
      const serialized: string = this.serialize(res);
      await this.producer(`${topic}:res`, serialized);
    });
  }
}

export default ArnelifyBroker;