#include <algorithm>
#include <concepts>
#include <cstdint>
#include <format>
#include <iostream>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace shapes {

enum class Color {
    red,
    green,
    blue,
};

inline constexpr double pi = 3.14159;
inline constexpr double unit_radius = 2.0;

class Shape {
public:
    Shape() = default;
    Shape(const Shape&) = delete;
    Shape& operator=(const Shape&) = delete;
    Shape(Shape&&) = delete;
    Shape& operator=(Shape&&) = delete;
    virtual ~Shape() = default;

    [[nodiscard]] virtual double area() const = 0;
};

class Circle : public Shape {
public:
    explicit Circle(double radius)
        : radius_{radius}
    {
    }

    [[nodiscard]] double area() const override
    {
        return pi * radius_ * radius_;
    }

private:
    double radius_;
};

template <std::integral T>
constexpr T square(T x)
{
    return x * x;
}

struct Point {
    int x{};
    int y{};
};

[[nodiscard]] int sum(std::span<const int> values)
{
    int total{};
    for (const int value : values) {
        total += value;
    }
    return total;
}

[[nodiscard]] std::string describe(std::string_view name, Color color)
{
    switch (color) {
    case Color::red:
        return std::format("{} is red", name);
    case Color::green:
        return std::format("{} is green", name);
    case Color::blue:
        return std::format("{} is blue", name);
    }
    return {};
}

}  // namespace shapes

int main()
{
    std::vector<int> numbers{3, 1, 2};
    numbers.push_back(shapes::sum(numbers));
    std::ranges::sort(numbers);
    auto circle = std::make_unique<shapes::Circle>(shapes::unit_radius);
    std::cout << shapes::describe("circle", shapes::Color::red) << '\n';
    std::cout << circle->area() << ' ' << shapes::sum(numbers) << '\n';
    return 0;
}
