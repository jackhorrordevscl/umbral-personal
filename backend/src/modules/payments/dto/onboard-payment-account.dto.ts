import { IsEmail, IsString, MaxLength } from 'class-validator';

// design.md "REST" table: POST /payments/account -- onboarding es un
// FORMULARIO, no un redirect OAuth (design.md "Onboarding is a FORM, not an
// OAuth redirect"). Estos tres campos son exactamente los que
// PaymentGatewayClient.createMerchant (MerchantInput) necesita, además de
// therapistId (que nunca viaja en el body -- sale de @CurrentUser()).
export class OnboardPaymentAccountDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MaxLength(50)
  rutOrTaxId: string;
}
