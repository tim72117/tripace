import type { Model3D } from '../../../three/model';
import { shuqiStairsModel } from './stop-shuqi-stairs';

// 小石階:輕便路西端往北上到茶樓肩,同款豎崎路石階的短版(約 7.8 m 長、爬升 3.4 m、約 20 階)。
// 階數由長度推出,所以踢面高度跟豎崎路一樣是人的尺度,不是把整座石階縮小。
const model: Model3D = shuqiStairsModel(7.8125);

export default model;
