import { Body, Controller, Get, Logger, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentIntentsService } from './payment-intents.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { CreateEpaycoSessionDto } from './dto/create-epayco-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('payment-intents')
@Controller({ path: 'payment-intents', version: '1' })
export class PaymentIntentsController {
  private readonly logger = new Logger(PaymentIntentsController.name);

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

  @Post('epayco/session')
  @ApiOperation({ summary: 'Crear sesión pública de ePayco Smart Checkout para compra de plan' })
  createEpaycoSession(@Body() dto: CreateEpaycoSessionDto) {
    return this.paymentIntentsService.createEpaycoSession(dto);
  }

  @Get('public/:id/epayco/session')
  @ApiOperation({ summary: 'Crear sesión pública de ePayco Smart Checkout para un payment intent' })
  createPublicPaymentIntentEpaycoSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentIntentsService.createEpaycoSessionForPaymentIntent(id);
  }

  @Get('epayco/reference/:refPayco')
  @ApiOperation({ summary: 'Consultar el estado de una transacción ePayco por ref_payco' })
  getEpaycoReference(@Param('refPayco') refPayco: string) {
    return this.paymentIntentsService.getEpaycoTransaction(refPayco);
  }

  @Post('epayco/confirmation')
  @ApiOperation({ summary: 'Webhook público de confirmación ePayco (sandbox)' })
  async epaycoConfirmation(@Body() payload: Record<string, unknown>) {
    this.logger.log(`Confirmación ePayco recibida: ${JSON.stringify(payload)}`);
    return this.paymentIntentsService.processEpaycoConfirmation(payload);
  }
}
