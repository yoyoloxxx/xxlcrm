// Иконки разделов: имя из конфига → lucide-компонент (безопасный фолбэк — папка)
import type { CSSProperties } from "react";
import {
  Briefcase, Building2, Cake, Calendar, Contact2, FileText, Folder, GraduationCap,
  Heart, Home, Megaphone, Package, ShoppingCart, Star, Target, Truck, Users, Wrench,
} from "lucide-react";

const MAP: Record<string, React.ElementType> = {
  briefcase: Briefcase, building: Building2, users: Users, folder: Folder, package: Package,
  cart: ShoppingCart, home: Home, wrench: Wrench, heart: Heart, star: Star,
  file: FileText, truck: Truck, graduation: GraduationCap, contact: Contact2, calendar: Calendar, cake: Cake,
  target: Target, megaphone: Megaphone,
};

export const ICON_NAMES = Object.keys(MAP);

export function EntIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const Ic = MAP[name] ?? Folder;
  return <Ic className={className} style={style} />;
}
