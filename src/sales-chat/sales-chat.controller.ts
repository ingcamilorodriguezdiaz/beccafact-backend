import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesChatService } from './sales-chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtUserDto } from '../auth/dto/jwt-user.dto';

@ApiTags('sales-chat')
@Controller({ version: '1' })
export class SalesChatController {
  constructor(private readonly salesChatService: SalesChatService) {}

  @Post('public/sales-chat/conversations')
  @ApiOperation({ summary: 'Crear conversación de ventas (público)' })
  createConversation(@Body() dto: CreateConversationDto) {
    return this.salesChatService.createConversation(dto);
  }

  @Get('public/sales-chat/conversations/:id/messages')
  @ApiOperation({ summary: 'Obtener mensajes de una conversación (público)' })
  getMessages(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesChatService.getMessages(id);
  }

  @Post('public/sales-chat/conversations/:id/messages')
  @ApiOperation({ summary: 'Enviar mensaje al agente (público)' })
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.salesChatService.sendMessage(id, dto);
  }

  @Get('public/sales-chat/plans')
  @ApiOperation({ summary: 'Listar planes activos (público)' })
  getPlans() {
    return this.salesChatService.getPlans();
  }

  @Get('admin/sales-conversations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar conversaciones de ventas (admin)' })
  listConversations(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesChatService.listConversations({
      status: status as any,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('admin/sales-conversations/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Detalle de conversación (admin)' })
  getConversation(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesChatService.getConversation(id);
  }

  @Patch('admin/sales-conversations/:id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cambiar estado de conversación (admin)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationStatusDto,
  ) {
    return this.salesChatService.updateStatus(id, dto);
  }

  @Post('sales-conversations/:id/generate-quote')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar cotización para una conversación' })
  generateQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUserDto,
  ) {
    return this.salesChatService.generateQuote(id);
  }
}
