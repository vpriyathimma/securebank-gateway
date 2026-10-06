import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { User, Mail, Phone, Shield } from 'lucide-react';

const userSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits'),
  role: z.enum(['Account Holder', 'Bank Teller', 'Bank Manager'], {
    required_error: 'Please select a role',
  }),
  status: z.enum(['active', 'inactive'], {
    required_error: 'Please select a status',
  }),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormProps {
  user?: any;
  onSubmit: (data: UserFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function UserForm({ user, onSubmit, onCancel, isLoading }: UserFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: user || {
      name: '',
      email: '',
      phone: '',
      role: 'Account Holder',
      status: 'active',
    },
  });

  const selectedRole = watch('role');
  const selectedStatus = watch('status');

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'Bank Manager': return '👑';
      case 'Bank Teller': return '🏛️';
      case 'Account Holder': return '👤';
      default: return '👤';
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'Bank Manager': 
        return 'Full system access including user management, account operations, and loan approvals';
      case 'Bank Teller': 
        return 'Customer service operations including account management and transaction processing';
      case 'Account Holder': 
        return 'Limited access to own accounts, transactions, and loan applications';
      default: return '';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="h-5 w-5" />
            <span>{user ? 'Edit User' : 'Create New User'}</span>
          </CardTitle>
          <CardDescription>
            {user ? 'Update user information and permissions' : 'Add a new user to the banking system'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Personal Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="flex items-center space-x-2">
                  <User className="h-4 w-4" />
                  <span>Full Name</span>
                </Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder="Enter full name"
                  className={errors.name ? 'border-red-500' : ''}
                />
                {errors.name && (
                  <p className="text-sm text-red-600">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center space-x-2">
                  <Mail className="h-4 w-4" />
                  <span>Email Address</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  {...register('email')}
                  placeholder="Enter email address"
                  className={errors.email ? 'border-red-500' : ''}
                />
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center space-x-2">
                  <Phone className="h-4 w-4" />
                  <span>Phone Number</span>
                </Label>
                <Input
                  id="phone"
                  {...register('phone')}
                  placeholder="Enter phone number"
                  className={errors.phone ? 'border-red-500' : ''}
                />
                {errors.phone && (
                  <p className="text-sm text-red-600">{errors.phone.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center space-x-2">
                  <Shield className="h-4 w-4" />
                  <span>Status</span>
                </Label>
                <Select 
                  value={selectedStatus} 
                  onValueChange={(value) => setValue('status', value as 'active' | 'inactive')}
                >
                  <SelectTrigger className={errors.status ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && (
                  <p className="text-sm text-red-600">{errors.status.message}</p>
                )}
              </div>
            </div>

            {/* Role Selection */}
            <div className="space-y-4">
              <Label className="flex items-center space-x-2">
                <Shield className="h-4 w-4" />
                <span>User Role</span>
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {['Account Holder', 'Bank Teller', 'Bank Manager'].map((role) => (
                  <div
                    key={role}
                    className={`relative cursor-pointer rounded-lg border p-4 hover:bg-gray-50 ${
                      selectedRole === role
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-gray-300'
                    }`}
                    onClick={() => setValue('role', role as any)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl">{getRoleIcon(role)}</span>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{role}</div>
                        </div>
                      </div>
                      <input
                        type="radio"
                        {...register('role')}
                        value={role}
                        className="h-4 w-4 text-blue-600"
                        checked={selectedRole === role}
                        onChange={() => {}}
                      />
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {getRoleDescription(role)}
                    </div>
                  </div>
                ))}
              </div>
              {errors.role && (
                <p className="text-sm text-red-600">{errors.role.message}</p>
              )}
            </div>

            {/* Selected Role Summary */}
            {selectedRole && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">
                  {getRoleIcon(selectedRole)} {selectedRole} Permissions
                </h4>
                <div className="text-sm text-blue-800">
                  {getRoleDescription(selectedRole)}
                </div>
                <div className="mt-2 text-xs text-blue-600">
                  {selectedRole === 'Bank Manager' && '• Full system access • User management • All banking operations'}
                  {selectedRole === 'Bank Teller' && '• Customer support • Account management • Transaction processing'}
                  {selectedRole === 'Account Holder' && '• Personal account access • Transaction history • Loan applications'}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving...' : user ? 'Update User' : 'Create User'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}