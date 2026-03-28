import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../auth.service';
import { JwtUserDto } from '../dto/jwt-user.dto';



@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    console.log('JWT_SECRET:', config.get('JWT_SECRET'));
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUserDto> {
    return {
      sub: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      branchId: payload.branchId ?? null,
      isSuperAdmin: payload.isSuperAdmin,
      roles: payload.roles,
    };
  }
}
