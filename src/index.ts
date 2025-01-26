import { parseRawDateTime, parseRawHistory, parseRawTime } from "./parsing";

export interface HistoryElement {
  time: Date;
  images: Record<string, number | null>;
}

class HTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getTeamInfo(team: string) {
  const teamInfoUrl = new URL("https://scoreboard.uscyberpatriot.org/api/image/scores.php"); // Replace with the actual API endpoint
  teamInfoUrl.searchParams.set("team", team);

  const historyUrl = new URL("https://scoreboard.uscyberpatriot.org/api/image/chart.php"); // Replace with the actual history API endpoint
  historyUrl.searchParams.set("team", team);

  const [teamInfoRes, historyRes] = await Promise.all([
    fetch(teamInfoUrl.toString()),
    fetch(historyUrl.toString()),
  ]);

  if (!teamInfoRes.ok) {
    throw new HTTPError(teamInfoRes.status, "Could not reach the team API");
  }

  if (!historyRes.ok) {
    throw new HTTPError(historyRes.status, "Could not reach the history API");
  }

  const { data: teamData } = await teamInfoRes.json() as any;
  const { cols, rows } = await historyRes.json() as any;

  if (!teamData || !teamData.length) {
    throw new HTTPError(404, "Team not found");
  }

  const images = teamData.map((item: any) => ({
    name: item.image.split("_")[0].replace(/([^0-9])([0-9])/g, '$1 $2'),
    runtime: item.duration,
    issues: {
      found: item.found,
      remaining: item.remaining,
    },
    penalties: item.penalties,
    score: item.ccs_score,
    multiple: false, // Adjust based on additional API fields if needed
    overtime: false, // Adjust based on additional API fields if needed
  }));

  const ranking = {national: 1, state: 1};
  const location = teamData[0].location;
  const division = teamData[0].division;
  const tier = teamData[0].tier;
  const runtime = teamData[0].duration;

  const history: HistoryElement[] = rows.map((row: any) => {
    const time = row.c[0].v.split(" ")[1]; // Parse the time string
    const images: Record<string, number | null> = {};

    cols.slice(1).forEach((col: any, index: number) => {
      images[col.label] = row.c[index + 1]?.v ?? null;
    });

    return { time, images };
  });

  const updated = new Date(); // Adjust if API provides an update timestamp

  return { images, ranking, history, updated, location, division, tier, runtime };
}

export async function handleRequest(request: Request) {
  try {
    const url = new URL(request.url);

    const path = url.pathname.substring(1);

    if (path === "info") {
      const teams = url.searchParams.get("teams")?.split(",") ?? [];

      const data: Record<string, Awaited<ReturnType<typeof getTeamInfo>> | null> = Object.fromEntries(
        await Promise.all(teams.map(async (team) => [team, await getTeamInfo(team).catch(() => null)])),
      );

      return new Response("{\"json\":" +JSON.stringify(data) + "}", {
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error instanceof HTTPError) {
        return new Response(error.message, {
          status: error.status,
          headers: {
            "access-control-allow-origin": "*",
          },
        });
      } else {
        return new Response("Internal Error: " + error.message, {
          status: 500,
        });
      }
    } else {
      return new Response("Internal Error", {
        status: 500,
      });
    }
  }
}

const setCors = (response: Response) => {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "*");
  response.headers.set("Access-Control-Allow-Headers", "*");

  return response;
};

const worker: ExportedHandler<Bindings> = { fetch: async (request) => setCors(await handleRequest(request)) };
export default worker;
