import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

const transferFormSchema = z.object({
  fromAccountId: z.string().min(1, "Please select a source account"),
  toAccountId: z.string().min(1, "Please select a destination account"),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number",
  }),
  description: z.string().min(1, "Description is required"),
});

type TransferFormData = z.infer<typeof transferFormSchema>;

interface TransferFormProps {
  onSuccess?: () => void;
}

export function TransferForm({ onSuccess }: TransferFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [formError, setFormError] = React.useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => apiRequest("/api/accounts"),
    enabled: !!user,
  });

  // For Account Holders: Get transfer destinations (other users' accounts)
  const { data: transferDestinations } = useQuery({
    queryKey: ["/api/transfer-destinations"],
    queryFn: () => apiRequest("/api/transfer-destinations"),
    enabled: !!user && user.role === "Account Holder",
  });

  const form = useForm<TransferFormData>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      fromAccountId: "",
      toAccountId: "",
      amount: "",
      description: "",
    },
  });

  // Helper to pull a readable message from the error shape
  const getReadableError = (err: any): string => {
    // Prefer server-provided body fields if present
    const data = err?.response?.data ?? err?.data;
    if (data && typeof data === "object") {
      if (typeof data.error === "string" && data.error.trim())
        return data.error;
      if (typeof data.message === "string" && data.message.trim())
        return data.message;
    }
    // Some libs put message directly on the error
    if (typeof err?.message === "string" && err.message.trim())
      return err.message;
    // Fallback
    return "Something went wrong.";
  };

  const transferMutation = useMutation({
    mutationFn: (data: TransferFormData) =>
      apiRequest("/api/transfer", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({
        title: "Transfer Successful",
        description: "The transfer has been completed successfully.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/transfer-destinations"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onSuccess?.();
    },
    onError: (error: any) => {
      if (error?.status === 403 || error?.response?.status === 403) {
        setFormError("You don't have access to transfer funds.");
      } else {
        // Show server error like: {"error":"Insufficient funds"}
        setFormError(getReadableError(error));
      }
    },
  });

  const onSubmit = (data: TransferFormData) => {
    transferMutation.mutate(data);
  };

  // For FROM account: Account Holders can only select their own accounts
  const userAccounts =
    user?.role === "Account Holder"
      ? accounts // Account Holders only see their own accounts from /api/accounts
      : accounts;

  // For TO account: Combine own accounts + transfer destinations for Account Holders
  const destinationAccounts =
    user?.role === "Account Holder"
      ? [
          ...(accounts || []), // Own accounts
          ...(transferDestinations || []).map((dest: any) => ({
            id: dest.id,
            accountNumber: dest.accountNumber,
            accountType: dest.accountType,
            userId: "other", // Mark as other user's account
            user: { name: dest.holderName },
          })),
        ]
      : accounts;

  const transferAmount = parseFloat(form.watch("amount") || "0");
  const fromAccountId = form.watch("fromAccountId");
  const toAccountId = form.watch("toAccountId");

  // Check if this is a same-user transfer
  const fromAccount = accounts?.find((acc: any) => acc.id === fromAccountId);
  const toAccount = accounts?.find((acc: any) => acc.id === toAccountId);
  const isSameUserTransfer = fromAccount?.userId === toAccount?.userId;

  // Show transfer limit warning for Account Holders only
  const showLimitWarning =
    user?.role === "Account Holder" &&
    !isSameUserTransfer &&
    transferAmount > 5000;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          From Account
        </label>
        <Select
          value={form.watch("fromAccountId")}
          onValueChange={(value) => form.setValue("fromAccountId", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select source account" />
          </SelectTrigger>
          <SelectContent>
            {userAccounts?.map((account: any) => (
              <SelectItem key={account.id} value={account.id}>
                {account.accountNumber} ({account.accountType}) - $
                {parseFloat(account.balance).toFixed(2)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.fromAccountId && (
          <p className="text-red-500 text-sm mt-1">
            {form.formState.errors.fromAccountId.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          To Account
        </label>
        <Select
          value={form.watch("toAccountId")}
          onValueChange={(value) => form.setValue("toAccountId", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select destination account" />
          </SelectTrigger>
          <SelectContent>
            {destinationAccounts?.map((account: any) => (
              <SelectItem key={account.id} value={account.id}>
                {account.accountNumber} ({account.accountType}) -{" "}
                {account.user?.name || "Unknown User"}
                {account.userId === user?.id && " (Your account)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.toAccountId && (
          <p className="text-red-500 text-sm mt-1">
            {form.formState.errors.toAccountId.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Amount ($)
        </label>
        <Input
          type="number"
          step="0.01"
          {...form.register("amount")}
          placeholder="0.00"
        />
        {form.formState.errors.amount && (
          <p className="text-red-500 text-sm mt-1">
            {form.formState.errors.amount.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <Textarea
          {...form.register("description")}
          placeholder="Enter transfer description..."
          rows={3}
        />
        {form.formState.errors.description && (
          <p className="text-red-500 text-sm mt-1">
            {form.formState.errors.description.message}
          </p>
        )}
      </div>

      <div className="bg-blue-50 p-3 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-1">Transfer Rules:</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          {user?.role === "Account Holder" ? (
            <>
              <li>
                • Transfer between your own accounts or to other customers: $
                5000 maximum
              </li>
              <li>• For higher amounts, contact a bank representative</li>
            </>
          ) : (
            <>
              <li>• Bank staff can process transfers of any amount</li>
              <li>• No transfer limits for Tellers and Managers</li>
              <li>• Can transfer between any accounts</li>
            </>
          )}
        </ul>
      </div>

      {formError && (
        <div
          className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
          aria-live="polite"
        >
          {formError}
        </div>
      )}

      <Button
        type="submit"
        disabled={transferMutation.isPending}
        className="w-full"
      >
        {transferMutation.isPending
          ? "Processing Transfer..."
          : "Transfer Funds"}
      </Button>
    </form>
  );
}
