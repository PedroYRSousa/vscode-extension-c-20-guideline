#ifndef EXAMPLE_CLEAN_H
#define EXAMPLE_CLEAN_H

#include <concepts>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace example {

template <typename T>
concept Printable = requires(T value) {
    { value.to_string() } -> std::convertible_to<std::string>;
};

template <typename T>
concept Number = std::integral<T> || std::floating_point<T>;

template <Number T>
class Stack {
public:
    using value_type = T;

    Stack() = default;

    void push(T value)
    {
        items_.push_back(value);
    }

    [[nodiscard]] std::optional<T> top() const
    {
        if (items_.empty()) {
            return std::nullopt;
        }
        return items_.back();
    }

    [[nodiscard]] bool empty() const noexcept
    {
        return items_.empty();
    }

private:
    std::vector<T> items_;
};

class Registry {
public:
    Registry() = default;
    Registry(const Registry&) = default;
    Registry& operator=(const Registry&) = default;
    Registry(Registry&&) noexcept = default;
    Registry& operator=(Registry&&) noexcept = default;
    ~Registry() = default;

    [[nodiscard]] bool contains(const std::string& key) const
    {
        return entries_.contains(key);
    }

    void add(std::string key, int value)
    {
        entries_[std::move(key)] = value;
    }

private:
    std::map<std::string, int> entries_;
};

[[nodiscard]] constexpr int twice(int value)
{
    return value * 2;
}

}  // namespace example

#endif  // EXAMPLE_CLEAN_H
