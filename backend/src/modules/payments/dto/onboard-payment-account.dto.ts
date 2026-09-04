import { IsEmail, IsString, MaxLength } from 'class-validator';

// design.md "REST" table: POST /payments/account -- onboarding is a
// FORM, not an OAuth redirect (design.md "Onboarding is a FORM, not an
// OAuth redirect"). These three fields are exactly what
// PaymentGatewayClient.createMerchant (MerchantInput) needs, besides
// therapistId (which never travels in the body -- it comes from @CurrentUser()).
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
