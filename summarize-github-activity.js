#!/usr/bin/env node

const { Octokit } = require("@octokit/rest");
const { OpenAI } = require("openai");
require("dotenv").config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const username = process.env.GITHUB_USERNAME;
const repos = process.env.GITHUB_REPOS.split(",").map((r) => r.trim());

// Parse command line arguments
const args = process.argv.slice(2);
let targetDateStr = "";
let timezoneOffsetHours = -new Date().getTimezoneOffset() / 60; // Default: use system timezone offset

// Check if a date was provided as an argument
if (args.length > 0) {
  targetDateStr = args[0];

  // Validate the date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
    console.error(
      `Error: Invalid date format "${targetDateStr}". Please use YYYY-MM-DD format.`,
    );
    process.exit(1);
  }

  // Check if timezone offset was provided as a second argument
  if (args.length > 1) {
    const offsetArg = parseInt(args[1]);
    if (!isNaN(offsetArg)) {
      timezoneOffsetHours = offsetArg;
    }
  }
} else {
  // If no date provided, use today's date in YYYY-MM-DD format
  const now = new Date();
  targetDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

console.log(`Using timezone offset: ${timezoneOffsetHours} hours from UTC`);

const isTargetDate = (dateString) => {
  // GitHub API returns dates in ISO format (UTC)
  const eventDate = new Date(dateString);

  // Apply timezone offset to get the local date for the event
  const localEventDate = new Date(
    eventDate.getTime() + timezoneOffsetHours * 60 * 60 * 1000,
  );

  // Extract just the date part in YYYY-MM-DD format
  const eventDateStr = localEventDate.toISOString().substring(0, 10);

  // Debug output
  // console.log(
  //   `Comparing: GitHub event (${dateString}) → Local (${eventDateStr}) vs Target (${targetDateStr})`,
  // );

  return eventDateStr === targetDateStr;
};

const getCommits = async (repo) => {
  const [owner, repoName] = repo.split("/");
  console.log(`Fetching commits authored by ${username} in ${repoName}...`);

  const { data: commits } = await octokit.rest.repos.listCommits({
    author: username,
    owner,
    repo: repoName,
    since: `${targetDateStr}T00:00:00Z`,
    until: `${targetDateStr}T23:59:59Z`,
  });
  // console.log("Commits:", commits);

  try {
    const arrayOfCommitMessages = [];

    for (const commit of commits) {
      if (commit.committer.login !== username) {
        continue;
      }
      arrayOfCommitMessages.push(`Commit: ${commit.commit.message}`);
    }

    return arrayOfCommitMessages;
  } catch (error) {
    console.error(`Error fetching commits for ${repoName}:`, error.message);
    return [];
  }
};

const getPullRequests = async (repo) => {
  const [owner, name] = repo.split("/");
  console.log(`Fetching PRs for ${repo}...`);

  try {
    // Get PRs for the repository
    const { data: pulls } = await octokit.rest.pulls.list({
      owner,
      repo: name,
      state: "all",
      per_page: 100,
    });

    const prs = [];

    for (const pr of pulls) {
      // Only include PRs created by you
      if (pr.user.login !== username) {
        continue;
      }

      if (isTargetDate(pr.created_at)) {
        prs.push(`Opened PR #${pr.number}: ${pr.title}`);
      }
    }

    return prs;
  } catch (error) {
    console.error(`Error fetching PRs for ${repo}:`, error.message);
    return [];
  }
};

const collectActivity = async () => {
  const activity = [];

  for (const repo of repos) {
    const commits = await getCommits(repo);
    const prs = await getPullRequests(repo);

    if (commits.length > 0 || prs.length > 0) {
      activity.push(`From ${repo}:`);
      activity.push(...commits, ...prs);
      activity.push(""); // Add blank line between repos
    }
  }

  return activity;
};

const summarizeWithOpenAI = async (activity) => {
  if (activity.length === 0) {
    return `No GitHub activity found for ${targetDateStr}.`;
  }

  const prompt = `
Summarize the following GitHub activity into 2–3 concise, objective sentences suitable for a client-facing timesheet entry. Use a professional tone, avoid first-person language, and omit repository names. Retain pull request numbers.

GitHub activity:
${activity.map((a) => `- ${a}`).join("\n")}
`.trim();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error calling OpenAI API:", error.message);
    return "Failed to generate summary due to API error.";
  }
};

(async () => {
  console.log(`\n📅 Generating summary for: ${targetDateStr}`);

  const activity = await collectActivity();
  console.log(`\nFound ${activity.length} activity items`);
  console.log("Activity items:\n", activity);

  const summary = await summarizeWithOpenAI(activity);
  console.log("\n📝 GitHub Summary:\n");
  console.log(summary);
})();
