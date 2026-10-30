import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintDependencies, type DetectedPackage } from "./fingerprint";

function index(detected: DetectedPackage[]): Map<string, DetectedPackage> {
  return new Map(detected.map((item) => [`${item.name}@${item.version}`, item]));
}

test("fingerprints library versions from pages, scripts, and a public manifest", () => {
  const page = `<!doctype html>
<html>
<head>
  <meta name="generator" content="Next.js 14.2.5" />
</head>
<body>
  <script id="__NEXT_DATA__" type="application/json">{"buildId":"abc123","nextVersion":"14.2.5"}</script>
  <script src="https://cdn.jsdelivr.net/npm/jquery@3.5.1/dist/jquery.min.js"></script>
  <script src="https://unpkg.com/axios@0.27.2/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@angular/core@16.2.12/bundles/core.umd.min.js"></script>
  <script src="/vendor/lodash-4.17.20.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
  <script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular.min.js"></script>
  <script src="https://esm.sh/vue@3.4.21"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
</body>
</html>`;
  const detected = index(
    fingerprintDependencies({
      pages: [
        {
          url: "https://app.example/",
          headers: { "x-powered-by": "Next.js" },
          body: page,
        },
      ],
      scripts: [
        {
          url: "inline:https://app.example/#1",
          pageUrls: ["https://app.example/"],
          body: "/*! jQuery v3.5.1 | (c) OpenJS Foundation */",
        },
        {
          url: "https://app.example/vendor/moment.js",
          pageUrls: ["https://app.example/"],
          body: "//! moment.js\n//! version : 2.29.1\n",
        },
        {
          url: "https://app.example/assets/vue.js",
          body: 'Vue.version = "2.7.16";',
        },
        {
          url: "https://app.example/assets/react.js",
          body: '/* @license React v17.0.2 */ var x = { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: 1, version: "18.3.1" }; x.version = "18.3.1";',
        },
        {
          url: "https://app.example/_next/static/chunks/main.js",
          body: 'self.__NEXT_VERSION = "15.0.3";',
        },
      ],
      packageJson: JSON.stringify({
        dependencies: { axios: "1.4.0", leftpad: "^1.2.3" },
        devDependencies: { semver: "7.5.1", minimist: "^1.2.5" },
      }),
      packageJsonUrl: "https://app.example/package.json",
    }),
  );

  const jquery = detected.get("jquery@3.5.1");
  assert.ok(jquery);
  assert.equal(jquery.confidence, "high");
  assert.ok(jquery.evidence.some((item) => item.source === "script_url" && item.url.includes("jquery@3.5.1") && item.snippet === "jquery@3.5.1"));
  assert.ok(jquery.evidence.some((item) => item.source === "banner" && item.snippet.includes("jQuery v3.5.1")));
  assert.equal(jquery.evidence[0]?.pageUrl, "https://app.example/");

  assert.equal(detected.get("axios@0.27.2")?.confidence, "high");
  assert.equal(detected.get("axios@1.4.0")?.confidence, "high");
  assert.equal(detected.get("axios@1.4.0")?.evidence[0]?.source, "package_json");
  assert.match(detected.get("axios@1.4.0")?.evidence[0]?.snippet ?? "", /axios/);

  assert.equal(detected.get("@angular/core@16.2.12")?.confidence, "high");
  assert.equal(detected.get("lodash@4.17.20")?.evidence[0]?.snippet, "lodash@4.17.20");
  assert.equal(detected.get("bootstrap@5.3.2")?.confidence, "high");
  assert.equal(detected.get("moment@2.29.4")?.confidence, "high");
  assert.equal(detected.get("moment@2.29.1")?.evidence[0]?.source, "banner");
  assert.equal(detected.get("angular@1.8.2")?.confidence, "high");
  assert.equal(detected.get("vue@3.4.21")?.confidence, "high");
  assert.equal(detected.get("vue@2.7.16")?.evidence[0]?.source, "global");
  assert.equal(detected.get("react-dom@18.2.0")?.confidence, "high");
  assert.equal(detected.get("react@17.0.2")?.confidence, "high");
  assert.equal(detected.get("react@18.3.1")?.confidence, "medium");
  assert.equal(detected.get("leftpad@1.2.3")?.confidence, "medium");
  assert.match(detected.get("leftpad@1.2.3")?.evidence[0]?.snippet ?? "", /checked 1\.2\.3/);
  assert.equal(detected.get("semver@7.5.1")?.confidence, "medium");
  assert.equal(detected.get("minimist@1.2.5")?.confidence, "low");

  const next = detected.get("next@14.2.5");
  assert.ok(next);
  assert.equal(next.confidence, "high");
  assert.ok(next.evidence.some((item) => item.source === "header" && item.snippet.includes("Next.js")));
  assert.ok(next.evidence.some((item) => item.source === "next_data" && item.snippet.includes("14.2.5")));
  assert.ok(next.evidence.some((item) => item.source === "banner" && item.snippet.includes("generator")));
  assert.equal(detected.get("next@15.0.3")?.evidence[0]?.source, "global");
  assert.equal(detected.has("next@abc123"), false);
});

test("a Next.js header without a version is not treated as a build id", () => {
  const detected = fingerprintDependencies({
    pages: [
      {
        url: "https://app.example/",
        headers: { "X-Powered-By": "Next.js" },
        body: '<script id="__NEXT_DATA__" type="application/json">{"buildId":"abc123","page":"/"}</script>',
      },
    ],
    scripts: [],
  });
  assert.deepEqual(detected, []);
});

test("an x-powered-by version is recorded with the header as evidence", () => {
  const detected = fingerprintDependencies({
    pages: [
      {
        url: "https://app.example/login",
        headers: { "x-powered-by": "Next.js/13.5.6" },
        body: "<html></html>",
      },
    ],
    scripts: [],
  });
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.name, "next");
  assert.equal(detected[0]?.version, "13.5.6");
  assert.equal(detected[0]?.confidence, "high");
  assert.match(detected[0]?.evidence[0]?.snippet ?? "", /Next\.js\/13\.5\.6/);
  assert.equal(detected[0]?.evidence[0]?.url, "https://app.example/login");
});

test("a broken manifest does not hide versions already present in the page", () => {
  const detected = fingerprintDependencies({
    pages: [
      {
        url: "https://app.example/",
        headers: {},
        body: '<script src="https://app.example/jquery-3.6.0.min.js"></script>',
      },
    ],
    scripts: [],
    packageJson: "{not json",
    packageJsonUrl: "https://app.example/package.json",
  });
  assert.equal(detected.length, 1);
  assert.equal(`${detected[0]?.name}@${detected[0]?.version}`, "jquery@3.6.0");
});
