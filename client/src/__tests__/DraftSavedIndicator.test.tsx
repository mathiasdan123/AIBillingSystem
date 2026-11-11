import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DraftSavedIndicator } from "@/components/DraftSavedIndicator";

/**
 * therapybill-qa #3: an autosave failure must be visible on the page. Until
 * this change the indicator had no error state, so a draft endpoint failing
 * on every call looked exactly like one that had simply not run yet.
 */
describe("DraftSavedIndicator", () => {
  it("renders nothing before the first save and no error", () => {
    const { container } = render(<DraftSavedIndicator saving={false} lastSavedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the saving state while a save is in flight", () => {
    render(<DraftSavedIndicator saving={true} lastSavedAt={null} error="old failure" />);
    expect(screen.getByTestId("draft-saving")).toHaveTextContent("Saving draft");
    expect(screen.queryByTestId("draft-save-error")).toBeNull();
  });

  it("shows 'Draft saved' after a successful save", () => {
    render(<DraftSavedIndicator saving={false} lastSavedAt={new Date()} error={null} />);
    expect(screen.getByTestId("draft-saved")).toHaveTextContent("Draft saved just now");
    expect(screen.queryByTestId("draft-save-error")).toBeNull();
  });

  it("shows 'Not saved' when the last autosave failed, even with no prior save", () => {
    render(<DraftSavedIndicator saving={false} lastSavedAt={null} error="Failed to save draft" />);
    const el = screen.getByTestId("draft-save-error");
    expect(el).toHaveTextContent("Not saved");
    expect(el).toHaveAttribute("title", "Failed to save draft");
    expect(screen.queryByTestId("draft-saved")).toBeNull();
  });

  it("keeps the last successful save time visible alongside the failure", () => {
    render(
      <DraftSavedIndicator
        saving={false}
        lastSavedAt={new Date(Date.now() - 2 * 60_000)}
        error="500: Failed to save soap draft"
      />,
    );
    expect(screen.getByTestId("draft-save-error")).toHaveTextContent("Not saved(last saved 2m ago)");
  });
});
