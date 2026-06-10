import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const docsSite = path.join(root, "dist", "docs-site");

describe("docs site", () => {
	beforeAll(() => {
		execFileSync(process.execPath, ["scripts/build-docs-site.mjs"], {
			cwd: root,
			stdio: "pipe",
		});
	});

	it("renders the Sign in page in onboarding order", () => {
		const install = fs.readFileSync(
			path.join(docsSite, "install.html"),
			"utf8",
		);
		const auth = fs.readFileSync(path.join(docsSite, "auth.html"), "utf8");

		expect(install).toContain('href="auth.html">Sign in</a>');
		expect(auth).toContain('href="install.html">Install</a>');
		expect(auth).toContain('href="quickstart.html">Quickstart</a>');
		expect(auth.indexOf(">Install</a>")).toBeLessThan(
			auth.indexOf(">Sign in</a>"),
		);
		expect(auth.indexOf(">Sign in</a>")).toBeLessThan(
			auth.indexOf(">Quickstart</a>"),
		);
		expect(auth).toContain("xurl whoami");
		expect(auth).not.toContain("--client-secret");
		expect(auth).not.toContain("BIRDCLAW_PROFILE");
	});

	it("keeps underscores inside autolink URLs literal", () => {
		const archive = fs.readFileSync(
			path.join(docsSite, "archive.html"),
			"utf8",
		);
		const expected =
			'<a href="https://x.com/settings/download_your_data">https://x.com/settings/download_your_data</a>';

		expect(archive).toContain(expected);
		expect(archive).not.toContain("download<em>your</em>data");
	});
});
