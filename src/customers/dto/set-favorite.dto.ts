import { IsBoolean } from 'class-validator';

export class SetFavoriteDto {
  @IsBoolean()
  isFavorite: boolean;
}
