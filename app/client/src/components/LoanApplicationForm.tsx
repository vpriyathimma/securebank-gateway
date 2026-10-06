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

const loanApplicationSchema = z.object({
  type: z.enum(['personal', 'auto', 'home', 'business'], {
    required_error: 'Please select a loan type',
  }),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number",
  }),
  termMonths: z.string().refine((val) => {
    const num = parseInt(val);
    return !isNaN(num) && num >= 6 && num <= 360;
  }, {
    message: "Term must be between 6 and 360 months",
  }),
  purpose: z.string().min(10, 'Please provide a detailed purpose for the loan (minimum 10 characters)'),
});

type LoanApplicationData = z.infer<typeof loanApplicationSchema>;

interface LoanApplicationFormProps {
  onSuccess?: () => void;
}

export function LoanApplicationForm({ onSuccess }: LoanApplicationFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const form = useForm<LoanApplicationData>({
    resolver: zodResolver(loanApplicationSchema),
    defaultValues: {
      type: undefined,
      amount: '',
      termMonths: '',
      purpose: '',
    },
  });

  const applicationMutation = useMutation({
    mutationFn: (data: LoanApplicationData) => 
      apiRequest('/api/loans/apply', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          termMonths: parseInt(data.termMonths),
        }),
      }),
    onSuccess: () => {
      toast({
        title: "Loan Application Submitted",
        description: "Your loan application has been submitted successfully and is pending review.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Application Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: LoanApplicationData) => {
    applicationMutation.mutate(data);
  };

  // Calculate estimated monthly payment
  const loanType = form.watch('type');
  const amount = parseFloat(form.watch('amount') || '0');
  const termMonths = parseInt(form.watch('termMonths') || '0');

  const interestRates = {
    personal: 8.5,
    auto: 6.75,
    home: 4.25,
    business: 9.5
  };

  let estimatedPayment = 0;
  if (loanType && amount > 0 && termMonths > 0) {
    const rate = interestRates[loanType] / 100 / 12;
    estimatedPayment = (amount * rate * Math.pow(1 + rate, termMonths)) / 
                      (Math.pow(1 + rate, termMonths) - 1);
  }

  if (user?.role !== 'Account Holder') {
    return (
      <div className="text-center p-6 bg-gray-50 rounded-lg">
        <p className="text-gray-600">Only Account Holders can apply for loans.</p>
        <p className="text-sm text-gray-500 mt-2">Bank staff should create loans directly through the loans management page.</p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Loan Type
        </label>
        <Select
          value={form.watch('type')}
          onValueChange={(value) => form.setValue('type', value as any)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select loan type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="personal">Personal Loan (8.5% APR)</SelectItem>
            <SelectItem value="auto">Auto Loan (6.75% APR)</SelectItem>
            <SelectItem value="home">Home Loan (4.25% APR)</SelectItem>
            <SelectItem value="business">Business Loan (9.5% APR)</SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.type && (
          <p className="text-red-500 text-sm mt-1">{form.formState.errors.type.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Loan Amount ($)
        </label>
        <Input
          type="number"
          step="0.01"
          {...form.register('amount')}
          placeholder="0.00"
        />
        {form.formState.errors.amount && (
          <p className="text-red-500 text-sm mt-1">{form.formState.errors.amount.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Term (Months)
        </label>
        <Input
          type="number"
          {...form.register('termMonths')}
          placeholder="e.g., 36 for 3 years"
        />
        {form.formState.errors.termMonths && (
          <p className="text-red-500 text-sm mt-1">{form.formState.errors.termMonths.message}</p>
        )}
        <p className="text-sm text-gray-500 mt-1">Between 6 months (0.5 years) and 360 months (30 years)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Purpose of Loan
        </label>
        <Textarea
          {...form.register('purpose')}
          placeholder="Describe what you plan to use this loan for..."
          rows={4}
        />
        {form.formState.errors.purpose && (
          <p className="text-red-500 text-sm mt-1">{form.formState.errors.purpose.message}</p>
        )}
      </div>

      {estimatedPayment > 0 && (
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Estimated Monthly Payment</h4>
          <p className="text-2xl font-bold text-blue-800">${estimatedPayment.toFixed(2)}</p>
          <p className="text-sm text-blue-600 mt-1">
            Based on {interestRates[loanType]}% APR for {termMonths} months
          </p>
          <p className="text-xs text-blue-500 mt-2">
            *Final terms subject to approval and may vary based on credit assessment
          </p>
        </div>
      )}

      <div className="bg-green-50 p-3 rounded-lg">
        <h4 className="font-medium text-green-900 mb-1">Application Process:</h4>
        <ul className="text-sm text-green-800 space-y-1">
          <li>• Submit your application with required details</li>
          <li>• Bank staff will review your application</li>
          <li>• You'll receive approval/rejection notification</li>
          <li>• If approved, funds will be available after signing</li>
        </ul>
      </div>

      <Button 
        type="submit" 
        disabled={applicationMutation.isPending}
        className="w-full"
      >
        {applicationMutation.isPending ? 'Submitting Application...' : 'Submit Loan Application'}
      </Button>
    </form>
  );
}