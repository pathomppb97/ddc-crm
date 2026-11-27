import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const blockedPaths = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)(?:agriculture-2027|agriculture-machines|sources)(?:\/|$)/i,
  /(?:^|\/)(?:agriculture2027|customerList|customerSegmentation2026|machineModels)\.json$/i,
  /\.(?:xlsx?|xlsm|docx?|pptx?|pdf|sqlite3?|dump|bak|pem|pfx|key|jsonl|zip|map)$/i,
];

function isBlocked(file) {
  return (
    file !== ".env.example" &&
    file !== "supabase/functions/.env.d365.example" &&
    blockedPaths.some((pattern) => pattern.test(file))
  );
}

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const blocked = tracked.filter(isBlocked);

if (process.argv.includes("--dist")) {
  const staticFiles = new Set(
    tracked
      .filter((file) => file.startsWith("public/"))
      .map((file) => file.slice("public/".length)),
  );

  for (const entry of readdirSync("dist", {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) continue;

    const file = path
      .relative("dist", path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join("/");
    const isBundle = /^assets\/[^/]+\.(?:js|css|png|svg|woff2?|ttf)$/i.test(
      file,
    );

    if (
      !entry.isFile() ||
      isBlocked(file) ||
      (file !== "index.html" && !isBundle && !staticFiles.has(file))
    ) {
      blocked.push("dist/" + file);
    }
  }

  readFileSync("dist/index.html");
}

if (blocked.length > 0) {
  console.error("Files blocked from the public demo:\n" + blocked.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public demo file checks passed.");
}
