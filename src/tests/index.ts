#!/usr/bin/env bun

import ArnelifyBroker from "../index";

import Ctx from "contracts/ctx";
import Res from "contracts/res";

(async function main(): Promise<number> {

  const broker: ArnelifyBroker = new ArnelifyBroker();

  broker.subscribe("second.welcome", async (ctx: Ctx): Promise<Res> => {
    const res: {[key: string]: any} = {};
    res["params"] = ctx["params"];
    res["params"]["success"] = "Welcome to Arnelify Broker";
    return res;
  });

  broker.subscribe("first.welcome", async (ctx: Ctx): Promise<Res> => {
    const res: {[key: string]: any} = {};
    res["params"] = ctx["params"];
    res["params"]["code"] = 200;
    return broker.call("second.welcome", res["params"]);
  });

  const ctx: {[key: string]: any} = {};
  ctx["params"] = {
    code: 0,
    success: ""
  };

  const res: Res = await broker.call("first.welcome", ctx["params"]);
  console.log(res.params);

  return 0;

})();