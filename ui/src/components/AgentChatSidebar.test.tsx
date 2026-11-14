// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@pilibalaai/shared";
import { AgentChatSidebar } from "./AgentChatSidebar";

vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ collapsed: false, peeking: false }) }));
vi.mock("@/components/SidebarNavItem", () => ({
  SidebarNavItem: ({ to, label }: { to: string; label: string }) => <a href={to}>{label}</a>,
}));
vi.mock("@/components/AgentIconPicker", () => ({ AgentIcon: () => null }));

const agents = [
  { id: "active", companyId: "company-a", name: "Active agent", urlKey: "active", role: "engineer", title: "Engineer", icon: null, status: "idle" },
  { id: "retired", companyId: "company-a", name: "Retired agent", urlKey: "retired", role: "engineer", title: "Engineer", icon: null, status: "terminated" },
] as Agent[];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AgentChatSidebar", () => {
  it("hides terminated agents from the chat navigation list", async () => {
    await act(async () => root.render(<AgentChatSidebar
      agents={agents}
      activeId="active"
      starredIds={["retired"]}
      recentIds={[]}
      onToggleStar={vi.fn()}
      onOpenChat={vi.fn()}
    />));

    const links = [...container.querySelectorAll("a")];
    expect(links.map(link => link.textContent)).toEqual(["Active agent"]);
    expect(container.textContent).not.toContain("Retired agent");
  });
});
