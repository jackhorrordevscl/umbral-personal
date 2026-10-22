import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination.dto';

// Issue #140: page/pageSize son opcionales y retrocompatibles. Judgment-day
// #501: page sin cota máxima producía un skip desbordado y un 500.
describe('PaginationQueryDto', () => {
  it('acepta una query vacía (sin paginar)', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});

    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta page y pageSize válidos', async () => {
    const dto = plainToInstance(PaginationQueryDto, {
      page: '2',
      pageSize: '100',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza pageSize mayor que 100', async () => {
    const dto = plainToInstance(PaginationQueryDto, { pageSize: '101' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'pageSize')).toBe(true);
  });

  it('acepta page en el tope (10000)', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '10000' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['10001', '9007199254740991'])(
    'rechaza page por encima del tope (%s)',
    async (page) => {
      const dto = plainToInstance(PaginationQueryDto, { page });

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'page')).toBe(true);
    },
  );
});
