import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// 🔧 Set your GitHub author email(s) used in commits:
const MY_EMAILS = ["austin@maddoxbox.com"];

// 🔧 Your GitHub username (for PRs and reviews)
const GITHUB_USERNAME = "AustinMaddox";

// 🔧 Repos to check (format: org/repo)
const REPOS = ["RicochetSolutions/v4-cdk-app"];

// ⏰ Time window
const today = new Date();
today.setHours(0, 0, 0, 0); // Set to beginning of today (00:00:00)
const since = today.toISOString();
const until = new Date(today);
until.setHours(23, 59, 59, 999); // Set to end of today (23:59:59.999)
const untilStr = until.toISOString();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("❌ Missing GITHUB_TOKEN in .env or environment");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "User-Agent": "github-activity-summarizer",
};

const getCommits = async (repo) => {
  const url = `https://api.github.com/repos/${repo}/commits?since=${since}&until=${untilStr}&per_page=100`;
  const res = await axios.get(url, { headers });

  return res.data
    .filter((c) => MY_EMAILS.includes(c.commit.author?.email))
    .map((c) => ({
      repo,
      type: "commit",
      message: c.commit.message.split("\n")[0],
      url: c.html_url,
    }));
};

const getPullRequests = async (repo) => {
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&per_page=100`;
  const res = await axios.get(url, { headers });

  return res.data
    .filter(
      (pr) =>
        pr.user?.login === GITHUB_USERNAME &&
        new Date(pr.created_at) >= new Date(since) &&
        new Date(pr.created_at) <= new Date(untilStr),
    )
    .map((pr) => ({
      repo,
      type: "pr",
      message: `Opened PR: ${pr.title}`,
      url: pr.html_url,
    }));
};

const getPRReviews = async (repo) => {
  const prsUrl = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=50`;
  const prs = (await axios.get(prsUrl, { headers })).data;

  const reviews = [];

  for (const pr of prs) {
    try {
      const reviewsUrl = pr.url + "/reviews";
      const res = await axios.get(reviewsUrl, { headers });

      res.data
        .filter(
          (review) =>
            review.user?.login === GITHUB_USERNAME &&
            new Date(review.submitted_at) >= new Date(since) &&
            new Date(review.submitted_at) <= new Date(untilStr),
        )
        .forEach((review) => {
          reviews.push({
            repo,
            type: "review",
            message: `Reviewed PR: ${pr.title}`,
            url: pr.html_url,
          });
        });
    } catch (err) {
      // Ignore PRs without review access
    }
  }

  return reviews;
};

const summarize = (items) => {
  if (items.length === 0) return "No GitHub activity today.";

  return items.map((item) => `• ${item.message}`).join("\n");
};

(async () => {
  const all = [];

  for (const repo of REPOS) {
    try {
      const [commits, prs, reviews] = await Promise.all([
        getCommits(repo),
        getPullRequests(repo),
        getPRReviews(repo),
      ]);

      all.push(...commits, ...prs, ...reviews);
    } catch (err) {
      console.error(`❌ Error fetching data for ${repo}:`, err.message);
    }
  }

  const summary = summarize(all);
  console.log("\n📝 GitHub Work Summary (Today):\n");
  console.log(summary);
})();
