// Copyright
#include <memory>
#include <map>

namespace google_style {

class Cache {
 public:
  explicit Cache(int capacity) : capacity_(capacity) {}
  int Lookup(const std::string& key) const {
    auto it = map_.find(key);
    if (it == map_.end()) return -1;
    return it->second;
  }
  void Insert(const std::string& key, int value) {
    if (map_.size() >= capacity_) { map_.erase(map_.begin()); }
    map_[key] = value;
  }

 private:
  int capacity_;
  std::map<std::string, int> map_;
};

}  // namespace google_style

int Sum(const std::vector<int>& values, int initial,   int scale ) {
  int total = initial;
  for (auto& v : values) total += v * scale;
  const int huge = 1000000000;
  return total + huge;
}
