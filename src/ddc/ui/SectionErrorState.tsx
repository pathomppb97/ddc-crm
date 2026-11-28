import { Component, useEffect, useMemo, type ReactNode } from "react";
import { useTranslate } from "ra-core";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { logCrmError } from "../errors/crmError";
import { useDdcLocale } from "./labels";

export const SectionErrorState = ({
  error,
  resource,
  operation = "load",
  onRetry,
}: {
  error: unknown;
  resource?: string;
  operation?: string;
  onRetry?: () => void;
}) => {
  const locale = useDdcLocale();
  const translate = useTranslate();
  const normalized = useMemo(
    () => logCrmError(error, { resource, operation }),
    [error, resource, operation],
  );

  useEffect(() => {
    logCrmError(error, { resource, operation });
  }, [error, resource, operation]);

  const message =
    locale === "en" ? normalized.userMessageEn : normalized.userMessageTh;

  return (
    <Alert variant="destructive" role="alert" className="min-w-0">
      <AlertCircle className="size-4 shrink-0" />
      <AlertTitle className="break-words">
        {translate("ddc.error.section_title")}
      </AlertTitle>
      <AlertDescription className="space-y-2 break-words">
        <p>{message}</p>
        <p className="font-mono text-xs opacity-80">
          {translate("ddc.error.ref_label")}: {normalized.requestId}
        </p>
        {normalized.retryable && onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="min-h-9 bg-background text-foreground"
          >
            <RefreshCw className="size-3.5" />
            {translate("ddc.common.retry")}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

interface BoundaryProps {
  resource?: string;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
}

export class SectionErrorBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    logCrmError(error, {
      resource: this.props.resource,
      operation: "render",
    });
  }

  render() {
    if (this.state.error) {
      return (
        <SectionErrorState
          error={this.state.error}
          resource={this.props.resource}
          operation="render"
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
