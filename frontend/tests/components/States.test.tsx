import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LoadingState,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  CardSkeleton,
  Field,
  AiNote,
} from "../../src/components/States";
import { strings } from "../../src/i18n/en";

describe("LoadingState", () => {
  it("renders the default loading label", () => {
    render(<LoadingState />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
  it("accepts a custom label", () => {
    render(<LoadingState label="Hold on…" />);
    expect(screen.getByText("Hold on…")).toBeInTheDocument();
  });
  it("has role=status for screen readers", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title + description + cta + icon", () => {
    render(
      <EmptyState
        title="No data"
        description="empty"
        icon="📭"
        cta={<button>do something</button>}
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("📭")).toBeInTheDocument();
    expect(screen.getByText("do something")).toBeInTheDocument();
  });
  it("works with just a title", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders message + role=alert", () => {
    render(<ErrorState message="boom" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
  it("fires onRetry when the button is clicked", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(<ErrorState message="oops" onRetry={() => (clicked = true)} />);
    await user.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });
  it("hides retry button when no callback provided", () => {
    render(<ErrorState message="oops" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("PageHeader", () => {
  it("renders title in h1", () => {
    render(<PageHeader title="Hello" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Hello" }),
    ).toBeInTheDocument();
  });
  it("renders subtitle when provided", () => {
    render(<PageHeader title="Hello" subtitle="World" />);
    expect(screen.getByText("World")).toBeInTheDocument();
  });
  it("renders actions when provided", () => {
    render(<PageHeader title="Hello" actions={<button>Act</button>} />);
    expect(screen.getByText("Act")).toBeInTheDocument();
  });
});

describe("Skeleton + CardSkeleton", () => {
  it("Skeleton renders aria-hidden div", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden");
  });
  it("CardSkeleton renders N + 1 children for `lines` prop", () => {
    const { container } = render(<CardSkeleton lines={4} />);
    expect(container.querySelectorAll("div div").length).toBeGreaterThanOrEqual(
      5,
    );
  });
  it("CardSkeleton uses default lines when none passed", () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelectorAll("div div").length).toBeGreaterThanOrEqual(
      4,
    );
  });
});

describe("Field", () => {
  it("wraps an input inside a label for accessibility", () => {
    render(
      <Field label="Email">
        <input type="email" />
      </Field>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Email").closest("label")).not.toBeNull();
  });
});

describe("AiNote", () => {
  it("renders the default AI disclaimer with role=note", () => {
    render(<AiNote />);
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(strings.ai.disclaimer);
  });
  it("accepts custom text (e.g. the report-specific disclaimer)", () => {
    render(<AiNote text={strings.ai.reportDisclaimer} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      strings.ai.reportDisclaimer,
    );
  });
});
