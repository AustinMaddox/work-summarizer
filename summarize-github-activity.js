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

const isToday = (dateString) => {
  const d = new Date(dateString);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
};

const getCommits = async (repo) => {
  const [owner, name] = repo.split("/");
  const { data: events } =
    await octokit.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100,
    });

  const commits = [];

  for (const event of events) {
    if (
      event.repo.name !== repo ||
      event.type !== "PushEvent" ||
      !isToday(event.created_at)
    ) {
      continue;
    }

    for (const commit of event.payload.commits) {
      commits.push(`Commit: ${commit.message}`);
    }
  }

  return commits;
};

const getPullRequests = async (repo) => {
  const [owner, name] = repo.split("/");
  const { data: pulls } = await octokit.rest.pulls.list({
    owner,
    repo: name,
    state: "all",
    per_page: 100,
  });

  const prs = [];

  for (const pr of pulls) {
    if (!isToday(pr.created_at)) continue;
    prs.push(`Opened PR #${pr.number}: ${pr.title}`);
  }

  return prs;
};

const collectActivity = async () => {
  const activity = [];

  for (const repo of repos) {
    const commits = await getCommits(repo);
    const prs = await getPullRequests(repo);
    activity.push(...commits, ...prs);
  }

  return activity;
};

const summarizeWithOpenAI = async (activity) => {
  if (activity.length === 0) return "No GitHub activity for today.";

  const prompt = `
Summarize the following GitHub activity into 2–3 concise, objective sentences suitable for a client-facing timesheet entry. Use a professional tone, avoid first-person language, and omit repository names. Retain pull request numbers.

GitHub activity:
${activity.map((a) => `- ${a}`).join("\n")}
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  });

  return response.choices[0].message.content.trim();
};

(async () => {
  const activity = await collectActivity();
  const summary = await summarizeWithOpenAI(activity);
  console.log("\n📝 GitHub Summary:\n");
  console.log(summary);
})();
