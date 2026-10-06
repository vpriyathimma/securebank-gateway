import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Calendar,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Filter,
  Download,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import type { AuditLog, AuditLogQuery } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface AuditLogResponse {
  auditLogs: AuditLog[];
  total: number;
  filters: Partial<AuditLogQuery>;
}

interface AuditStatsResponse {
  stats: {
    totalRequests: number;
    allowedRequests: number;
    deniedRequests: number;
    highRiskActions: number;
    roleBreakdown: Record<string, number>;
    actionBreakdown: Record<string, number>;
    riskLevelBreakdown: Record<string, number>;
    recentActivity: Array<{
      id: string;
      principalRole: string;
      action: string;
      decision: string;
      riskLevel: string;
      createdAt: Date;
    }>;
  };
}

export default function AuditLogsPage() {
  const [filters, setFilters] = useState<Partial<AuditLogQuery>>({
    limit: 50,
    offset: 0,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedDecision, setSelectedDecision] = useState<string>("");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hasExportPermission, setHasExportPermission] =
    useState<boolean>(false);

  const {
    data: auditData,
    isLoading,
    refetch,
  } = useQuery<AuditLogResponse>({
    queryKey: ["/api/audit-logs", filters],
    retry: 1,
  });

  const { data: statsData, isLoading: statsLoading } =
    useQuery<AuditStatsResponse>({
      queryKey: ["/api/audit-logs/stats/summary"],
      retry: 1,
    });

  const applyFilters = () => {
    const newFilters: Partial<AuditLogQuery> = {
      limit: 50,
      offset: 0,
    };

    if (searchTerm) {
      newFilters.action = searchTerm;
    }
    if (selectedRole && selectedRole !== "all") {
      newFilters.principalRole = selectedRole as any;
    }
    if (selectedDecision && selectedDecision !== "all") {
      newFilters.decision = selectedDecision as any;
    }
    if (selectedRiskLevel && selectedRiskLevel !== "all") {
      newFilters.riskLevel = selectedRiskLevel as any;
    }
    if (dateFrom) {
      newFilters.fromDate = dateFrom;
    }
    if (dateTo) {
      newFilters.toDate = dateTo;
    }

    setFilters(newFilters);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedRole("all");
    setSelectedDecision("all");
    setSelectedRiskLevel("all");
    setDateFrom("");
    setDateTo("");
    setFilters({ limit: 50, offset: 0 });
  };

  // Function to check CSV Export permission (user-based, not log-specific)
  const checkExportPermission = async () => {
    try {
      const response = await apiRequest("/api/audit-logs/export-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasExportPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking CSV Export permission:", error);
      setHasExportPermission(false);
      return false;
    }
  };

  // Check permission once when component loads
  useEffect(() => {
    checkExportPermission();
  }, []);

  const exportAuditLogs = () => {
    if (!auditData?.auditLogs.length) {
      alert("No audit logs to export");
      return;
    }

    // Create CSV content
    const headers = [
      "Date/Time",
      "Principal Role",
      "Action",
      "Decision",
      "Risk Level",
      "Resource Type",
      "Resource ID",
      "Business Context",
      "Processing Time (ms)",
      "IP Address",
      "Outcome",
    ];

    const csvContent = [
      headers.join(","),
      ...auditData.auditLogs.map((log) =>
        [
          `"${formatDate(log.createdAt)}"`,
          `"${log.principalRole}"`,
          `"${log.action}"`,
          `"${log.decision}"`,
          `"${log.riskLevel || "unknown"}"`,
          `"${log.resourceType || ""}"`,
          `"${log.resourceId || ""}"`,
          `"${(log.businessContext || "").replace(/"/g, '""')}"`,
          `"${log.processingTimeMs || ""}"`,
          `"${log.ipAddress || ""}"`,
          `"${log.actionOutcome || ""}"`,
        ].join(",")
      ),
    ].join("\n");

    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `audit_logs_${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getRiskLevelBadge = (riskLevel: string) => {
    switch (riskLevel) {
      case "critical":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Critical
          </Badge>
        );
      case "high":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            High
          </Badge>
        );
      case "medium":
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Medium
          </Badge>
        );
      case "low":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Low
          </Badge>
        );
      default:
        return <Badge variant="outline">{riskLevel}</Badge>;
    }
  };

  const getDecisionBadge = (decision: string) => {
    return decision === "Allow" ? (
      <Badge
        variant="outline"
        className="text-green-600 border-green-600 flex items-center gap-1"
      >
        <CheckCircle className="w-3 h-3" />
        Allow
      </Badge>
    ) : (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="w-3 h-3" />
        Deny
      </Badge>
    );
  };

  const formatDate = (date: string | Date) => {
    return format(new Date(date), "MMM dd, yyyy 'at' HH:mm:ss");
  };

  return (
    <div className="p-6 space-y-6" data-testid="audit-logs-page">
      <div className="flex justify-between items-center">
        <div>
          <h1
            className="text-2xl font-bold text-gray-900 dark:text-white"
            data-testid="page-title"
          >
            Authorization Audit Logs
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Monitor and review all Cedar authorization decisions for compliance
            and security analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            data-testid="button-refresh"
            disabled={isLoading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
          {hasExportPermission && (
            <Button
              onClick={exportAuditLogs}
              variant="outline"
              size="sm"
              data-testid="button-export"
              disabled={!auditData?.auditLogs.length}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      {statsData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Total Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold"
                data-testid="stat-total-requests"
              >
                {statsData.stats.totalRequests.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">
                Allowed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold text-green-600"
                data-testid="stat-allowed"
              >
                {statsData.stats.allowedRequests.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">
                {(
                  (statsData.stats.allowedRequests /
                    statsData.stats.totalRequests) *
                  100
                ).toFixed(1)}
                %
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">
                Denied
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold text-red-600"
                data-testid="stat-denied"
              >
                {statsData.stats.deniedRequests.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">
                {(
                  (statsData.stats.deniedRequests /
                    statsData.stats.totalRequests) *
                  100
                ).toFixed(1)}
                %
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">
                High Risk
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold text-orange-600"
                data-testid="stat-high-risk"
              >
                {statsData.stats.highRiskActions.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">
                {(
                  (statsData.stats.highRiskActions /
                    statsData.stats.totalRequests) *
                  100
                ).toFixed(1)}
                %
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
          <CardDescription>
            Filter audit logs by various criteria to find specific authorization
            events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search-action">Action</Label>
              <Input
                id="search-action"
                placeholder="Search actions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-action"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-role">User Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger data-testid="select-role">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="Account Holder">Account Holder</SelectItem>
                  <SelectItem value="Bank Teller">Bank Teller</SelectItem>
                  <SelectItem value="Bank Manager">Bank Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-decision">Decision</Label>
              <Select
                value={selectedDecision}
                onValueChange={setSelectedDecision}
              >
                <SelectTrigger data-testid="select-decision">
                  <SelectValue placeholder="All decisions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All decisions</SelectItem>
                  <SelectItem value="Allow">Allow</SelectItem>
                  <SelectItem value="Deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-risk">Risk Level</Label>
              <Select
                value={selectedRiskLevel}
                onValueChange={setSelectedRiskLevel}
              >
                <SelectTrigger data-testid="select-risk-level">
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-from">From Date</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-to">To Date</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilters} data-testid="button-apply-filters">
              Apply Filters
            </Button>
            <Button
              onClick={clearFilters}
              variant="outline"
              data-testid="button-clear-filters"
            >
              Clear All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Authorization Events</CardTitle>
          <CardDescription>
            {auditData
              ? `Showing ${auditData.auditLogs.length} of ${auditData.total} events`
              : "Loading audit logs..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div
              className="flex justify-center py-8"
              data-testid="loading-indicator"
            >
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : auditData?.auditLogs.length === 0 ? (
            <div
              className="text-center py-8 text-gray-500"
              data-testid="no-logs-message"
            >
              No audit logs found matching your criteria.
            </div>
          ) : (
            <div className="space-y-4">
              {auditData?.auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="border rounded-lg p-4 space-y-3"
                  data-testid={`audit-log-${log.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {log.principalRole}
                      </Badge>
                      {getDecisionBadge(log.decision)}
                      {getRiskLevelBadge(log.riskLevel || "unknown")}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Calendar className="w-4 h-4" />
                      {formatDate(log.createdAt)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-600 dark:text-gray-300">
                        Action:
                      </span>
                      <p
                        className="font-mono text-blue-600 dark:text-blue-400"
                        data-testid={`action-${log.id}`}
                      >
                        {log.action}
                      </p>
                    </div>
                    {log.resourceType && (
                      <div>
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          Resource:
                        </span>
                        <p data-testid={`resource-${log.id}`}>
                          {log.resourceType}
                          {log.resourceId
                            ? ` (${log.resourceId.slice(0, 8)}...)`
                            : ""}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="font-medium text-gray-600 dark:text-gray-300">
                        Processing Time:
                      </span>
                      <p data-testid={`processing-time-${log.id}`}>
                        {log.processingTimeMs}ms
                      </p>
                    </div>
                    {log.ipAddress && (
                      <div>
                        <span className="font-medium text-gray-600 dark:text-gray-300">
                          IP Address:
                        </span>
                        <p
                          className="font-mono"
                          data-testid={`ip-address-${log.id}`}
                        >
                          {log.ipAddress}
                        </p>
                      </div>
                    )}
                  </div>

                  {log.reasons && (
                    <div>
                      <span className="font-medium text-gray-600 dark:text-gray-300">
                        Reasons:
                      </span>
                      <div className="mt-1">
                        {JSON.parse(log.reasons).map(
                          (reason: string, index: number) => (
                            <p
                              key={index}
                              className="text-sm bg-gray-50 dark:bg-gray-800 p-2 rounded"
                              data-testid={`reason-${log.id}-${index}`}
                            >
                              {reason}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {log.complianceFlags && (
                    <div>
                      <span className="font-medium text-orange-600">
                        Compliance Flags:
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {JSON.parse(log.complianceFlags).map(
                          (flag: string, index: number) => (
                            <Badge
                              key={index}
                              variant="destructive"
                              className="text-xs"
                              data-testid={`compliance-flag-${log.id}-${index}`}
                            >
                              {flag}
                            </Badge>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
