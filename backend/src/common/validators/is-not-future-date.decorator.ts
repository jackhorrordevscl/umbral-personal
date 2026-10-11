import { ValidationOptions, registerDecorator } from 'class-validator';
import { chileDayKeyFromInstant } from '../utils/chile-time.util';

// A birth date in the future makes the age negative and the minor/adult
// logic meaningless. Dates are compared as calendar days: the value's day is
// read in UTC (birthDate is stored as UTC midnight, see age.util.ts) and
// "today" is the Chile calendar day, so a patient born today is accepted for
// the whole Santiago day. YYYY-MM-DD strings compare lexicographically.
export function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options: {
        message: 'La fecha no puede ser futura',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const parsed = new Date(value);
          if (Number.isNaN(parsed.getTime())) return false;
          return (
            parsed.toISOString().slice(0, 10) <=
            chileDayKeyFromInstant(new Date())
          );
        },
      },
    });
  };
}
