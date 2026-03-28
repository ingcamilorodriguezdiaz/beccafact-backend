import { JwtUserDto } from '@/auth/dto/jwt-user.dto';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';


export const CurrentUser = createParamDecorator(
  (data: keyof JwtUserDto | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtUserDto = request.user;

    return data ? user?.[data] : user;
  },
);