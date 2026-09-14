# smartmetra-ai
SmartMetra AI — a three-role (consumer/company/government) web platform for Legal Metrology compliance checks on packaged commodities. Scans package images, runs OCR + a rule-based compliance engine against the Packaged Commodities Rules 2011, flags issues with evidence, and never invents missing data. SIH26034 · Team Packshield.
# SmartMetra AI — Evidence-First Legal Metrology Compliance Platform

**Smart India Hackathon 2026 · Problem Statement ID: SIH26034**
**Team: Packshield** | Theme: Smart Governance / Consumer Protection | Category: Software

SmartMetra AI is a three-role web platform that checks compliance of packaged commodities against the **Legal Metrology (Packaged Commodities) Rules, 2011** by scanning real product package images — instead of relying on slow, manual, and inaccessible inspection. It brings consumers, companies, and government regulators onto one system, so a single scan of a product carries through the entire lifecycle: detection, verification, complaint, and resolution.

## The Problem

Consumers are vulnerable to unsafe, counterfeit, and non-compliant products because manual inspection is slow, error-prone, and gives consumers no direct way to check a package themselves before or after purchase. Regulators, on the other hand, are stretched thin — manually reviewing every package on the market is not feasible, so most non-compliant products go undetected until a complaint is raised, if one ever is. Companies, meanwhile, often have no easy way to self-audit their own packaging before it reaches shelves, leading to unintentional violations and costly recalls or penalties later.

This creates a three-sided gap: consumers lack tools, companies lack early feedback, and regulators lack scale — and packaged goods slip through with missing or incorrect mandatory declarations like MRP, net quantity, manufacturing date, or consumer care details.

## The Solution

SmartMetra AI closes that gap with **three role-specific interfaces sharing one evidence trail**, instead of a single generic dashboard. A scan or complaint filed by a consumer stays linked to the same underlying image evidence as it moves from consumer to company to government — so no one downstream has to take a claim on faith, and no one has to re-collect evidence that already exists.

| Role | What they do |
|---|---|
| 🧑 **Consumer** | Scan a package before or after buying it, see which mandatory declarations are present or missing, and file a complaint directly from the same scan if something looks wrong |
| 🏢 **Company** | Run pre-launch compliance checks on packaging before it goes to market, manage registered products, monitor compliance trends, and respond directly to consumer complaints raised against their products |
| 🏛️ **Government** | Review incoming complaints, launch and track formal inspections, verify or override AI-generated findings, view risk maps across products/regions, and take enforcement action — all backed by the original evidence |

This turns compliance from a reactive, paperwork-heavy process into something closer to continuous, shared monitoring: consumers surface problems as they shop, companies catch issues before launch, and regulators focus their limited time on the cases that are actually flagged as high-risk.

## Core principle: evidence-first, never invented

The entire system is built around one non-negotiable rule: **the AI never fabricates product data.** Every declaration it reports — brand, MRP, net quantity, manufacturing date, and so on — is either read directly off the uploaded package image or explicitly marked `NOT DETECTED` if it can't be confidently read. Nothing is silently filled in or assumed.

Every field also carries a confidence level, so a shaky or partially obscured reading is visibly different from a clear one. Any flagged issue links directly back to the specific image and confidence score it came from, so a human reviewer can immediately see *why* something was flagged rather than just being told that it was. Findings stay in a "review required" state and are never treated as a final legal conclusion until a human — a company officer or a government inspector — explicitly confirms or rejects them. This keeps the AI in a decision-support role: it surfaces and organizes evidence quickly, but a person always makes the final call.
