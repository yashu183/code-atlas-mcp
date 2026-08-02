// YAML extractor. YAML here is almost always either an Azure DevOps /
// GitHub Actions pipeline or a k8s/docker-compose manifest — neither has
// "symbols" in the code sense, so instead of a call graph we extract
// coarse structural nodes (stage/job names, or k8s kind+name) purely so
// search results can point at the right *stage*, not just the right file.
// The whole file is still embedded as a single chunk for semantic search
// (e.g. "which pipeline deploys to prod").

import yaml from "js-yaml";

export function extractYamlNodes(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch {
    return []; // malformed/templated YAML (e.g. Helm with Go templates) — skip structural parse, still embeddable as raw text by the caller
  }
  if (!doc || typeof doc !== "object") return [];

  const nodes = [];

  // Azure DevOps / GitHub Actions style: top-level `stages:` or `jobs:`
  for (const key of ["stages", "jobs"]) {
    if (Array.isArray(doc[key])) {
      for (const item of doc[key]) {
        if (item?.stage || item?.job) {
          nodes.push({ kind: "config", name: item.stage || item.job, qualifiedName: `${key}.${item.stage || item.job}` });
        }
      }
    } else if (doc[key] && typeof doc[key] === "object") {
      // GitHub Actions `jobs:` is a map, not a list
      for (const jobName of Object.keys(doc[key])) {
        nodes.push({ kind: "config", name: jobName, qualifiedName: `${key}.${jobName}` });
      }
    }
  }

  // k8s / docker-compose style manifests: `kind: Deployment` + `metadata.name`
  if (doc.kind && doc.metadata?.name) {
    nodes.push({ kind: "config", name: doc.metadata.name, qualifiedName: `${doc.kind}.${doc.metadata.name}` });
  }
  if (doc.services && typeof doc.services === "object") {
    for (const svcName of Object.keys(doc.services)) {
      nodes.push({ kind: "config", name: svcName, qualifiedName: `services.${svcName}` });
    }
  }

  return nodes;
}
