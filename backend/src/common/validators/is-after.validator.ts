import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5, spec.md "Invalid time range
// is rejected"): validador de cross-field genérico -- compara el campo
// decorado contra otro campo del mismo objeto usando `>`. Sirve tanto para
// number (ScheduleEntryDto: startMinute/endMinute) como para Date
// (CreateBlockoutDto: startsAt/endsAt tras @Type(() => Date) -- el
// ValidationPipe global corre con `transform: true`, así que el valor ya
// llega convertido cuando esta validación se ejecuta).
export function IsAfter(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];

          if (value instanceof Date && relatedValue instanceof Date) {
            return value.getTime() > relatedValue.getTime();
          }
          if (typeof value === 'number' && typeof relatedValue === 'number') {
            return value > relatedValue;
          }
          // Tipos no comparables (undefined, NaN, etc.): que lo capture el
          // decorador de tipo correspondiente (@IsInt, @IsDate), no este.
          return false;
        },
        defaultMessage(args: ValidationArguments): string {
          const [relatedPropertyName] = args.constraints as [string];
          return `${args.property} debe ser posterior a ${relatedPropertyName}`;
        },
      },
    });
  };
}
