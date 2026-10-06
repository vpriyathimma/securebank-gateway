import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Account, User } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EditFullAccountModalProps {
  account: (Account & { user: User }) | null;
  isOpen: boolean;
  onClose: () => void;
}

interface AccountHolderForm {
  fullName: string;
  ssn: string;
  dateOfBirth: string;
  homeAddress: string;
  phone: string;
  alternatePhone: string;
  email: string;
  employerName: string;
  annualIncome: string;
  creditScore: string;
}

export function EditFullAccountModal({ account, isOpen, onClose }: EditFullAccountModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [formData, setFormData] = useState({
    balance: account?.balance || "0.00",
    status: account?.status || "active",
    interestRate: account?.interestRate || "0.0000",
    overdraftLimit: account?.overdraftLimit || "0.00",
    monthlyFee: account?.monthlyFee || "0.00",
    minimumBalance: account?.minimumBalance || "0.00",
    creditLimit: account?.creditLimit || "0.00",
    notes: account?.notes || "",
  });

  const [accountHolderData, setAccountHolderData] = useState<AccountHolderForm>({
    fullName: account?.user?.fullName || "",
    ssn: account?.user?.ssn || "",
    dateOfBirth: account?.user?.dateOfBirth ? new Date(account.user.dateOfBirth).toISOString().split('T')[0] : "",
    homeAddress: account?.user?.homeAddress || "",
    phone: account?.user?.phone || "",
    alternatePhone: account?.user?.alternatePhone || "",
    email: account?.user?.email || "",
    employerName: account?.user?.employerName || "",
    annualIncome: account?.user?.annualIncome || "",
    creditScore: account?.user?.creditScore?.toString() || "",
  });

  // Reset form when account changes
  useEffect(() => {
    if (account) {
      setFormData({
        balance: account.balance,
        status: account.status,
        interestRate: account.interestRate || "0.0000",
        overdraftLimit: account.overdraftLimit || "0.00",
        monthlyFee: account.monthlyFee || "0.00",
        minimumBalance: account.minimumBalance || "0.00",
        creditLimit: account.creditLimit || "0.00",
        notes: account.notes || "",
      });

      setAccountHolderData({
        fullName: account.user?.fullName || "",
        ssn: account.user?.ssn || "",
        dateOfBirth: account.user?.dateOfBirth ? new Date(account.user.dateOfBirth).toISOString().split('T')[0] : "",
        homeAddress: account.user?.homeAddress || "",
        phone: account.user?.phone || "",
        alternatePhone: account.user?.alternatePhone || "",
        email: account.user?.email || "",
        employerName: account.user?.employerName || "",
        annualIncome: account.user?.annualIncome || "",
        creditScore: account.user?.creditScore?.toString() || "",
      });
    }
  }, [account]);

  const updateAccountMutation = useMutation({
    mutationFn: async (data: { accountData: typeof formData; holderData: AccountHolderForm }) => {
      if (!account) throw new Error("No account selected");
      return apiRequest(`/api/accounts/${account.id}/full-edit`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      
      if (data.approved === false) {
        toast({
          title: "Changes Submitted for Approval",
          description: "Your changes have been submitted to a Bank Manager for approval.",
        });
      } else {
        toast({
          title: "Success",
          description: "Account updated successfully",
        });
      }
      onClose();
    },
    onError: (error: Error) => {
      console.error("Update account error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateAccountMutation.mutate({
      accountData: formData,
      holderData: accountHolderData
    });
  };

  const handleClose = () => {
    if (account) {
      setFormData({
        balance: account.balance,
        status: account.status,
        interestRate: account.interestRate || "0.0000",
        overdraftLimit: account.overdraftLimit || "0.00",
        monthlyFee: account.monthlyFee || "0.00",
        minimumBalance: account.minimumBalance || "0.00",
        creditLimit: account.creditLimit || "0.00",
        notes: account.notes || "",
      });

      setAccountHolderData({
        fullName: account.user?.fullName || "",
        ssn: account.user?.ssn || "",
        dateOfBirth: account.user?.dateOfBirth ? new Date(account.user.dateOfBirth).toISOString().split('T')[0] : "",
        homeAddress: account.user?.homeAddress || "",
        phone: account.user?.phone || "",
        alternatePhone: account.user?.alternatePhone || "",
        email: account.user?.email || "",
        employerName: account.user?.employerName || "",
        annualIncome: account.user?.annualIncome || "",
        creditScore: account.user?.creditScore?.toString() || "",
      });
    }
    onClose();
  };

  if (!account) return null;

  // Fields that require Manager approval for Bank Tellers
  const sensitiveAccountFields = ['interestRate', 'overdraftLimit', 'creditLimit'];
  const sensitiveHolderFields = ['ssn', 'creditScore', 'annualIncome'];
  
  const accountRequiresApproval = user?.role === 'Bank Teller' && 
    sensitiveAccountFields.some(field => formData[field as keyof typeof formData] !== (account[field as keyof Account] || "0.00"));
  
  const holderRequiresApproval = user?.role === 'Bank Teller' && 
    sensitiveHolderFields.some(field => {
      const currentValue = field === 'creditScore' ? account?.user?.creditScore?.toString() || "" : account?.user?.[field as keyof User]?.toString() || "";
      return accountHolderData[field as keyof AccountHolderForm] !== currentValue;
    });

  const requiresApproval = accountRequiresApproval || holderRequiresApproval;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Account Details</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Account Holder Personal Information */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-3">Account Holder Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fullName">Full Legal Name</Label>
                <Input
                  id="fullName"
                  value={accountHolderData.fullName}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, fullName: e.target.value }))}
                  data-testid="input-full-name"
                />
              </div>
              <div>
                <Label htmlFor="ssn">
                  Social Security Number
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="ssn"
                  placeholder="XXX-XX-XXXX"
                  value={user?.role === 'Bank Teller' && accountHolderData.ssn ? accountHolderData.ssn.replace(/\d(?=\d{4})/g, 'X') : accountHolderData.ssn}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, ssn: e.target.value }))}
                  data-testid="input-ssn"
                />
              </div>
              <div>
                <Label htmlFor="dateOfBirth">Date of Birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={accountHolderData.dateOfBirth}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                  data-testid="input-date-of-birth"
                />
              </div>
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={accountHolderData.email}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, email: e.target.value }))}
                  data-testid="input-email"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4">
              <div>
                <Label htmlFor="homeAddress">Home Address</Label>
                <Textarea
                  id="homeAddress"
                  value={accountHolderData.homeAddress}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, homeAddress: e.target.value }))}
                  rows={2}
                  data-testid="textarea-home-address"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="phone">Primary Phone</Label>
                  <Input
                    id="phone"
                    value={accountHolderData.phone}
                    onChange={(e) => setAccountHolderData(prev => ({ ...prev, phone: e.target.value }))}
                    data-testid="input-phone"
                  />
                </div>
                <div>
                  <Label htmlFor="alternatePhone">Alternate Phone</Label>
                  <Input
                    id="alternatePhone"
                    value={accountHolderData.alternatePhone}
                    onChange={(e) => setAccountHolderData(prev => ({ ...prev, alternatePhone: e.target.value }))}
                    data-testid="input-alternate-phone"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Employment & Financial Information */}
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-medium text-green-900 mb-3">Employment & Financial Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="employerName">Employer Name</Label>
                <Input
                  id="employerName"
                  value={accountHolderData.employerName}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, employerName: e.target.value }))}
                  data-testid="input-employer-name"
                />
              </div>
              <div>
                <Label htmlFor="annualIncome">
                  Annual Income ($)
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="annualIncome"
                  type="number"
                  step="0.01"
                  min="0"
                  value={accountHolderData.annualIncome}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, annualIncome: e.target.value }))}
                  data-testid="input-annual-income"
                />
              </div>
              <div>
                <Label htmlFor="creditScore">
                  Credit Score
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="creditScore"
                  type="number"
                  min="300"
                  max="850"
                  value={accountHolderData.creditScore}
                  onChange={(e) => setAccountHolderData(prev => ({ ...prev, creditScore: e.target.value }))}
                  data-testid="input-credit-score"
                />
              </div>
              <div>
                <Label htmlFor="account-number">Account Number</Label>
                <Input
                  id="account-number"
                  value={account.accountNumber}
                  disabled
                  className="bg-gray-100"
                />
              </div>
            </div>
          </div>

          {/* Basic Account Information */}
          <div className="bg-purple-50 p-4 rounded-lg">
            <h4 className="font-medium text-purple-900 mb-3">Account Balance & Status</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="balance">Account Balance</Label>
                <Input
                  id="balance"
                  type="number"
                  step="0.01"
                  value={formData.balance}
                  onChange={(e) => setFormData(prev => ({ ...prev, balance: e.target.value }))}
                  required
                  data-testid="input-balance"
                />
              </div>
              <div>
                <Label htmlFor="status">Account Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                >
                  <SelectTrigger data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="frozen">Frozen</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Financial Terms */}
          <div className="bg-orange-50 p-4 rounded-lg">
            <h4 className="font-medium text-orange-900 mb-3">Account Financial Terms</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="interestRate">
                  Interest Rate (%)
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="interestRate"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="100"
                  value={formData.interestRate}
                  onChange={(e) => setFormData(prev => ({ ...prev, interestRate: e.target.value }))}
                  data-testid="input-interest-rate"
                />
              </div>
              <div>
                <Label htmlFor="monthlyFee">Monthly Fee ($)</Label>
                <Input
                  id="monthlyFee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.monthlyFee}
                  onChange={(e) => setFormData(prev => ({ ...prev, monthlyFee: e.target.value }))}
                  data-testid="input-monthly-fee"
                />
              </div>
              <div>
                <Label htmlFor="minimumBalance">Minimum Balance ($)</Label>
                <Input
                  id="minimumBalance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.minimumBalance}
                  onChange={(e) => setFormData(prev => ({ ...prev, minimumBalance: e.target.value }))}
                  data-testid="input-minimum-balance"
                />
              </div>
            </div>
          </div>

          {/* Credit & Overdraft Limits */}
          <div className="bg-red-50 p-4 rounded-lg">
            <h4 className="font-medium text-red-900 mb-3">Credit Limits & Overdraft</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="overdraftLimit">
                  Overdraft Limit ($)
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="overdraftLimit"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.overdraftLimit}
                  onChange={(e) => setFormData(prev => ({ ...prev, overdraftLimit: e.target.value }))}
                  data-testid="input-overdraft-limit"
                />
              </div>
              <div>
                <Label htmlFor="creditLimit">
                  Credit Limit ($)
                  {user?.role === 'Bank Teller' && <Badge variant="secondary" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="creditLimit"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.creditLimit}
                  onChange={(e) => setFormData(prev => ({ ...prev, creditLimit: e.target.value }))}
                  data-testid="input-credit-limit"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes">Account Notes</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this account..."
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
              data-testid="textarea-notes"
            />
          </div>

          {/* Approval Notice */}
          {requiresApproval && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
              <h4 className="font-medium text-yellow-800 mb-2">Manager Approval Required</h4>
              <p className="text-sm text-yellow-700">
                Changes to sensitive fields (interest rates, credit limits, SSN, credit score, income) require Bank Manager approval.
                Your changes will be submitted for review.
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-bank-blue hover:bg-blue-700"
              disabled={updateAccountMutation.isPending}
              data-testid="button-save-account"
            >
              {updateAccountMutation.isPending ? "Saving..." : requiresApproval ? "Submit for Approval" : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}