import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentIntentsService } from './payment-intents.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('payment-intents')
@Controller({ path: 'payment-intents', version: '1' })
export class PaymentIntentsController {
  constructor(private readonly paymentIntentsService: PaymentIntentsService) {}

  @Post('simulate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear PaymentIntent simulado' })
  createSimulated(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentIntentsService.createSimulated(dto.conversationId, dto.amount, dto.quoteId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Webhook de pago' })
  webhook(@Body() dto: PaymentWebhookDto) {
    return this.paymentIntentsService.processWebhook(dto);
  }
}
