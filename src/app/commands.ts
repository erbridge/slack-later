import { Middleware, RespondFn, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { ErrorCode as WebAPIErrorCode, WebClient } from "@slack/web-api";
import * as chrono from "chrono-node";
import dayjs, { Dayjs } from "dayjs";
import calendar from "dayjs/plugin/calendar";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(calendar);
dayjs.extend(timezone);
dayjs.extend(utc);

const naturalDateParser = new chrono.Chrono(
  chrono.en.createCasualConfiguration(true)
);

const fetchUserLocalization = async (
  client: WebClient,
  { user }: { user: string }
) => {
  const response = await client.users.info({ user });

  const { tz } = response.user as { locale: string; tz: string };

  return { tz };
};

const parseFutureDate = (referenceMoment: dayjs.Dayjs, text: string) => {
  const utcOffset = referenceMoment.utcOffset();
  const referenceDate = referenceMoment.add(utcOffset, "minute").toDate();

  const parsedDates = naturalDateParser.parse(text, referenceDate, {
    forwardDate: true,
  });

  const parsedDateResult = parsedDates[parsedDates.length - 1];

  if (parsedDateResult?.end) {
    return;
  }

  const parsedDateComponents = parsedDateResult.start;
  const parsedDate = parsedDateComponents.date();
  const date = dayjs.utc(parsedDate).subtract(utcOffset, "minute");

  return { text: parsedDateResult.text, date };
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
    postAt: Dayjs;
    postAtHumanReadable: string;
  }
) => {
  try {
    await client.chat.scheduleMessage({
      channel,
      post_at: postAt.unix().toString(),
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

  const { tz } = await fetchUserLocalization(client, {
    user: command.user_id,
  });

  const now = dayjs().tz(tz);
  const parsedDate = parseFutureDate(now, command.text);

  if (!parsedDate) {
    await respondWithError(respond, {
      error: `I didn't understand \`${command.command} ${command.text}\`.`,
    });

    return;
  }

  const what = command.text
    .replace(parsedDate.text, "")
    .trim()
    .replace(/^['"\p{Pi}]|['"\p{Pf}]$/gu, "");

  if (!what) {
    await respondWithError(respond, {
      error: `\`${command.command} ${command.text}\` didn't contain a message to schedule.`,
    });

    return;
  }

  const postAt = parsedDate.date;
  const when = postAt.tz(tz).calendar(now, {
    sameDay: "[Today at] HH:mm",
    nextDay: "[Tomorrow at] HH:mm",
    nextWeek: "dddd [at] HH:mm",
    sameElse: "dddd DD MMMM YYYY [at] HH:mm",
  });

  await scheduleMessage(client, respond, {
    channel: command.channel_id,
    sender: command.user_name,
    text: what,
    postAt,
    postAtHumanReadable: when,
  });
};
