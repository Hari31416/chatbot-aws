import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { checkHealth } from "@/services/api";

export function useHealth() {
  const [apiBaseUrl, setApiBaseUrl] = React.useState<string>(() => {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost && import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
    return (
      localStorage.getItem("api_base_url") ||
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:8080"
    );
  });

  const [functionUrl, setFunctionUrl] = React.useState<string>(() => {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost && import.meta.env.VITE_FUNCTION_URL) {
      return import.meta.env.VITE_FUNCTION_URL;
    }
    return (
      localStorage.getItem("function_url") ||
      import.meta.env.VITE_FUNCTION_URL ||
      localStorage.getItem("api_base_url") ||
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:8080"
    );
  });

  React.useEffect(() => {
    localStorage.setItem("api_base_url", apiBaseUrl);
  }, [apiBaseUrl]);

  React.useEffect(() => {
    localStorage.setItem("function_url", functionUrl);
  }, [functionUrl]);

  const isSameUrl =
    apiBaseUrl.replace(/\/$/, "") === functionUrl.replace(/\/$/, "");

  const {
    data: isBackendOnline,
    refetch: recheckBackendHealth,
    isFetching: isCheckingHealth,
    status: backendHealthStatus,
  } = useQuery({
    queryKey: ["backendHealth", apiBaseUrl],
    queryFn: () => checkHealth(apiBaseUrl),
    refetchInterval: 30000,
  });

  const {
    data: isFunctionOnline,
    refetch: recheckFunctionHealth,
    isFetching: isCheckingFunction,
    status: functionHealthStatus,
  } = useQuery({
    queryKey: ["functionHealth", functionUrl],
    queryFn: () =>
      isSameUrl
        ? Promise.resolve(isBackendOnline ?? false)
        : checkHealth(functionUrl),
    refetchInterval: 30000,
    enabled: !isSameUrl || backendHealthStatus !== "pending",
  });

  return {
    apiBaseUrl,
    setApiBaseUrl,
    functionUrl,
    setFunctionUrl,
    isBackendOnline,
    recheckBackendHealth,
    isCheckingHealth,
    backendHealthStatus,
    isFunctionOnline,
    recheckFunctionHealth,
    isCheckingFunction,
    functionHealthStatus,
  };
}
