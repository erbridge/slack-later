import { App } from "@slack/bolt";
import * as commands from "./commands";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.command("/later", commands.later);

export default app;
