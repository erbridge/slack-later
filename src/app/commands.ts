import { Middleware, RespondFn, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { ErrorCode as WebAPIErrorCode, WebClient } from "@slack/web-api";
import * as chrono from "chrono-node";
import * as moment from "moment-timezone";

const naturalDateParser = new chrono.Chrono(
  chrono.en.createCasualConfiguration(true)
);

const fetchUserLocalization = async (
  client: WebClient,
  { user }: { user: string }
) => {
  const response = await client.users.info({
    user,
    include_locale: true,
  });

  const { locale, tz } = response.user as { locale: string; tz: string };

  return { locale, tz };
};

const parseFutureDate = (referenceDate: Date, text: string) => {
  const parsedDates = naturalDateParser.parse(text, referenceDate, {
    forwardDate: true,
  });

  const parsedDate = parsedDates[parsedDates.length - 1];

  if (parsedDate?.end) {
    return;
  }

  return parsedDate;
};

const respondWithError = async (
  respond: RespondFn,
  { error }: { error: string }
) => {
  return respond({
    response_type: "ephemeral",
    text: error,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: error,
        },
      },
    ],
  });
};

const respondWithContext = async (
  respond: RespondFn,
  { text, context }: { text: string; context: string }
) => {
  return respond({
    response_type: "ephemeral",
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: context,
          },
        ],
      },
    ],
  });
};

const scheduleMessage = async (
  client: WebClient,
  respond: RespondFn,
  {
    channel,
    sender,
    text,
    postAt,
    postAtHumanReadable,
  }: {
    channel: string;
    sender: string;
    text: string;
    postAt: Date;
    postAtHumanReadable: string;
  }
) => {
  try {
    await client.chat.scheduleMessage({
      channel,
      post_at: Math.floor(postAt.getTime() / 1000).toString(),
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `From @${sender}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err.code !== WebAPIErrorCode.PlatformError) {
      throw err;
    }

    if (err.data.error === "time_in_past") {
      await respondWithError(respond, {
        error: `${postAtHumanReadable} is in the past. You can only schedule messages for times in the future.`,
      });

      return;
    }

    if (err.data.error === "time_too_far") {
      await respondWithError(respond, {
        error: `${postAtHumanReadable} is too far in the future. You can only schedule messages up to 120 days in the future.`,
      });

      return;
    }

    throw err;
  }

  await respondWithContext(respond, {
    text,
    context: `Scheduled for ${postAtHumanReadable}`,
  });
};

export const later: Middleware<SlackCommandMiddlewareArgs> = async ({
  client,
  command,
  ack,
  respond,
}) => {
  await ack();

  const { locale, tz } = await fetchUserLocalization(client, {
    user: command.user_id,
  });

  const now = moment().tz(tz);
  const parsedDate = parseFutureDate(now.toDate(), command.text);

  if (!parsedDate) {
    await respondWithError(respond, {
      error: `I didn't understand \`${command.command} ${command.text}\`.`,
    });

    return;
  }

  const postAt = parsedDate.date();

  const what = command.text
    .replace(parsedDate.text, "")
    .trim()
    .replace(/^['"\p{Pi}]|['"\p{Pf}]$/gu, "");
  const when = moment(postAt)
    .tz(tz)
    .locale(locale)
    .calendar(now, { sameElse: "dddd DD MMMM YYYY [at] LT" });

  await scheduleMessage(client, respond, {
    channel: command.channel_id,
    sender: command.user_name,
    text: what,
    postAt,
    postAtHumanReadable: when,
  });
};
