import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

const loanEditSchema = z.object({
  type: z.enum(['personal', 'auto', 'home', 'business']),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number",
  }),
  interestRate: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Interest rate must be a positive number",
  }),
  termMonths: z.string().refine((val) => {
    const num = parseInt(val);
    return !isNaN(num) && num >= 6 && num <= 360;
  }, {
    message: "Term must be between 6 and 360 months",
  }),
  status: z.enum(['pending', 'approved', 'rejected', 'active', 'paid_off']),
  notes: z.string().optional(),
});

type LoanEditData = z.infer<typeof loanEditSchema>;

interface LoanEditFormProps {
  loan: any;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function LoanEditForm({ loan, onSuccess, onCancel }: LoanEditFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const form = useForm<LoanEditData>({
    resolver: zodResolver(loanEditSchema),
    defaultValues: {
      type: loan.type,
      amount: loan.amount,
      interestRate: loan.interestRate,
      termMonths: loan.termMonths.toString(),
      status: loan.status,
      notes: loan.notes || '',
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: LoanEditData) => {
      // Calculate new monthly payment if amount, rate, or term changed
      const loanAmount = parseFloat(data.amount);
      const monthlyRate = parseFloat(data.interestRate) / 100 / 12;
      const termMonths = parseInt(data.termMonths);
      const monthlyPayment = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                            (Math.pow(1 + monthlyRate, termMonths) - 1);

      const updateData = {
        ...data,
        termMonths: parseInt(data.termMonths),
        monthlyPayment: monthlyPayment.toFixed(2),
        // Keep remaining balance proportional if loan amount changed
        remainingBalance: loan.status === 'pending' 
          ? loanAmount.toFixed(2) 
          : (parseFloat(loan.remainingBalance) * (loanAmount / parseFloat(loan.amount))).toFixed(2)
      };

      return apiRequest(`/api/loans/${loan.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Loan Updated",
        description: "The loan has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: LoanEditData) => {
    editMutation.mutate(data);
  };

  if (user?.role === 'Account Holder') {
    return (
      <div className="text-center p-6 bg-gray-50 rounded-lg">
        <p className="text-gray-600">Account holders cannot edit loans.</p>
      </div>
    );
  }

  const formatCurrency = (amount: string) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(amount));

  // Calculate estimated monthly payment
  const amount = parseFloat(form.watch('amount') || '0');
  const interestRate = parseFloat(form.watch('interestRate') || '0');
  const termMonths = parseInt(form.watch('termMonths') || '0');

  let estimatedPayment = 0;
  if (amount > 0 && interestRate > 0 && termMonths > 0) {
    const rate = interestRate / 100 / 12;
    estimatedPayment = (amount * rate * Math.pow(1 + rate, termMonths)) / 
                      (Math.pow(1 + rate, termMonths) - 1);
  }

  return (
    <div className="space-y-6">
      {/* Current Loan Summary */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">Current Loan Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-blue-700">Borrower:</span>
            <span className="ml-2 text-blue-900">{loan.user?.name}</span>
          </div>
          <div>
            <span className="text-blue-700">Current Status:</span>
            <span className="ml-2 text-blue-900 capitalize">{loan.status}</span>
          </div>
          <div>
            <span className="text-blue-700">Original Amount:</span>
            <span className="ml-2 text-blue-900">{formatCurrency(loan.amount)}</span>
          </div>
          <div>
            <span className="text-blue-700">Remaining Balance:</span>
            <span className="ml-2 text-blue-900">{formatCurrency(loan.remainingBalance)}</span>
          </div>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Loan Type
            </label>
            <Select
              value={form.watch('type')}
              onValueChange={(value) => form.setValue('type', value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal Loan</SelectItem>
                <SelectItem value="auto">Auto Loan</SelectItem>
                <SelectItem value="home">Home Loan</SelectItem>
                <SelectItem value="business">Business Loan</SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.type && (
              <p className="text-red-500 text-sm mt-1">{form.formState.errors.type.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Loan Status
            </label>
            <Select
              value={form.watch('status')}
              onValueChange={(value) => form.setValue('status', value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paid_off">Paid Off</SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.status && (
              <p className="text-red-500 text-sm mt-1">{form.formState.errors.status.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Loan Amount ($)
            </label>
            <Input
              type="number"
              step="0.01"
              {...form.register('amount')}
            />
            {form.formState.errors.amount && (
              <p className="text-red-500 text-sm mt-1">{form.formState.errors.amount.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Interest Rate (%)
            </label>
            <Input
              type="number"
              step="0.01"
              {...form.register('interestRate')}
            />
            {form.formState.errors.interestRate && (
              <p className="text-red-500 text-sm mt-1">{form.formState.errors.interestRate.message}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Term (Months)
          </label>
          <Input
            type="number"
            {...form.register('termMonths')}
          />
          {form.formState.errors.termMonths && (
            <p className="text-red-500 text-sm mt-1">{form.formState.errors.termMonths.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <Textarea
            {...form.register('notes')}
            placeholder="Add any notes about this loan..."
            rows={3}
          />
        </div>

        {estimatedPayment > 0 && (
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-medium text-green-900 mb-2">Updated Monthly Payment</h4>
            <p className="text-2xl font-bold text-green-800">${estimatedPayment.toFixed(2)}</p>
            <p className="text-sm text-green-600 mt-1">
              Based on {interestRate}% APR for {termMonths} months
            </p>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={editMutation.isPending}>
            {editMutation.isPending ? 'Updating...' : 'Update Loan'}
          </Button>
        </div>
      </form>
    </div>
  );
}