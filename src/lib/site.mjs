// Typed-ish accessors over the archive content model (src/data/site.json).
import site from '../data/site.json';

export const SECTIONS = {
  observe: { title: 'To Observe and Report', short: 'Observe & Report', path: '/to-observe-and-report/' },
  show: { title: 'To Show and Tell', short: 'Show & Tell', path: '/to-show-and-tell/' },
};

export function sectionOf(slug) {
  return site.articles.find((a) => a.slug === slug);
}

export function articlesIn(section) {
  return site.articles
    .filter((a) => a.section === section)
    .sort((a, b) => a.order - b.order);
}

export function nextArticle(current, section) {
  const list = articlesIn(section);
  const i = list.findIndex((a) => a.slug === current.slug);
  return list[i + 1] || null;
}

export function prevArticle(current, section) {
  const list = articlesIn(section);
  const i = list.findIndex((a) => a.slug === current.slug);
  return list[i - 1] || null;
}

/** First photograph in an article, or the section cover. */
export function leadImage(article) {
  const img = article.blocks.find((b) => b.type === 'img');
  return img ? img.file : sectionCover(article.section);
}

export function sectionCover(section) {
  return site.sections[section].image;
}

export function sectionDesc(section) {
  return site.sections[section].description;
}

/** Human-readable ordinal, e.g. 01 */
export function two(n) {
  return String(n).padStart(2, '0');
}

export default site;