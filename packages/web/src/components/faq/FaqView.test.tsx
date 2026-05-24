import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FaqView } from "./FaqView";
import { faqSections } from "./faqContent";

describe("FaqView", () => {
  it("renders every question as a heading", () => {
    render(<FaqView clusterLabel="devnet" />);
    const questions = faqSections("devnet").flatMap((s) =>
      s.items.map((i) => i.q)
    );
    expect(questions.length).toBeGreaterThanOrEqual(15);
    for (const q of questions) {
      expect(screen.getByRole("heading", { name: q })).toBeInTheDocument();
    }
  });

  it("renders every section title", () => {
    render(<FaqView clusterLabel="devnet" />);
    for (const section of faqSections("devnet")) {
      expect(
        screen.getByRole("heading", { name: section.title })
      ).toBeInTheDocument();
    }
  });

  it("gives every question a non-empty answer", () => {
    render(<FaqView clusterLabel="devnet" />);
    for (const section of faqSections("devnet")) {
      for (const item of section.items) {
        const panel = document.getElementById(item.id);
        expect(panel, `panel for ${item.id}`).not.toBeNull();
        // The answer text lives below the question heading; the panel should hold
        // more than just the question itself.
        expect(panel!.textContent!.length).toBeGreaterThan(item.q.length + 20);
      }
    }
  });

  it("calls out test money on a non-mainnet cluster", () => {
    render(<FaqView clusterLabel="devnet" />);
    const realMoney = document.getElementById("is-this-real-money")!;
    expect(within(realMoney).getByText(/test network/i)).toBeInTheDocument();
    expect(realMoney.textContent).toMatch(/devnet/i);
    expect(realMoney.textContent).not.toMatch(/^Yes\./);
  });

  it("says it is real money on mainnet", () => {
    render(<FaqView clusterLabel="mainnet" />);
    const realMoney = document.getElementById("is-this-real-money")!;
    expect(realMoney.textContent).toMatch(/real/i);
    expect(
      within(realMoney).queryByText(/test money/i)
    ).not.toBeInTheDocument();
  });

  it("links to the markets page from the closing CTA", () => {
    render(<FaqView clusterLabel="devnet" />);
    const cta = screen.getByRole("link", { name: /browse markets/i });
    expect(cta).toHaveAttribute("href", "/markets");
  });
});
