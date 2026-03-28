export class JwtUserDto {
  sub: string;
  email: string;
  companyId: string | null;
  branchId?: string| null;   
  isSuperAdmin: boolean;
  roles: string[];
}